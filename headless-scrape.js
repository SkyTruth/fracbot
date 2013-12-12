// Dependencies
// http://phantomjs.org/
// http://casperjs.org/
// usage:
//  casperjs headless-scrape.js
// Production configuration is live=true, test_xxx = false.
// If all test_xxx are true (and live=false) the result is 
// identical to live=true but with debug output.
var live = false; // Use fracbotserver for all operations
var test_fbot_js = true;  // Use fracbot.js from fracbotserver.
var test_task = true; // Use fracbotserver for task assignment
var test_log = true; // Send log messages to fracbotserver
var test_update = true; // Call downloadAllPages to update PDFs to fracbotserver

var fracbot_url = "http://ewn4.skytruth.org/fracbot/";
var fracbot_js_url = fracbot_url + 'fracbot.user.js';
var fracbot_task_url = fracbot_url + 'task';
var fracbot_log_url = fracbot_url + 'client-log';
var search_url =
    'http://www.fracfocusdata.org/DisclosureSearch/StandardSearch.aspx';
var results_url = '/DisclosureSearch/SearchResults.aspx';
var sel_search_btn = "#MainContent_btnSearch";
var sel_next_btn = "input#MainContent_GridView1_ButtonNext";
var sel_page_num = "input#MainContent_GridView1_PageCurrent";

var utils = require('utils');
var xpath = require('casper').selectXPath;

// Create casper object
// skip_task and timeout_counts are used in response to timeout events.
var skip_task = false;
var timeout_count = 0;
var timeout_total = 0;
if (live) {
    verbose = false;
    log_level = 'info';
    clientScripts = [];
    remoteScripts = [fracbot_js_url];
} else {
    verbose = true;
    log_level = 'debug';
    if (test_fbot_js) {
        clientScripts = [];
        remoteScripts = [fracbot_js_url];
    } else {
        clientScripts = ['fracbot.js'];
        remoteScripts = [];
    }
}
var casper = require('casper').create({
        verbose: verbose,
        log_level: log_level,
        waitTimeout: 180000,
        onWaitTimeout: function () {
            log_message('error', 'Error: Request timeout.');
            timeout_count += 1;
            timeout_total += 1;
            skip_task = true;
            wait(10000);
        },
        remoteScripts: remoteScripts,
        clientScripts: clientScripts,
        pageSettings: {
            'userAgent': 'Mozilla/5.0 (Windows NT 6.1; rv:25.0) Gecko/20100101 Firefox/25.0',
            'localToRemoteUrlAccessEnabled': true
        }
});

// set user agent
// casper.userAgent('Mozilla/5.0 (Windows NT 6.1; rv:25.0) Gecko/20100101 Firefox/25.0');

// Tests for errors on receipt of resources.
casper.on('resource.received', function (resource) {
    if (resource.status > 399) {
        msg_type = 'error';
        if (resource.url.search('skytruth') >= 0) {
            if (resource.status == 500) {
                msg_type = 'warn';
                logmsg = "Warning: Skytruth server internal error on " +
                    resource.url;
            } else {
                logmsg = "Abort: Skytruth server resource error on " +
                    resource.url;
            }
        } else {
            logmsg = "Abort: External resource error on " + resource.url;
        }
        logdata = {
            'url': resource.url,
            'status': resource.status,
            'statusText': resource.statusText
        };
        // logging error on log url can lead to infinite loop.
        if (resource.url != fracbot_log_url) {
            log_message(msg_type, logmsg, logdata);
        } else {
            utils.dump(logdata);
        }
        if (msg_type == 'error') {
            skip_task = true;
        }
    }
});

casper.on("page.error", function (msg, trace) {
    logmsg = "Abort: Javascript error: " + msg;
    logdata = {
        "traceback": trace
    };
    log_message("error", logmsg, logdata);
    skip_task = true;
});

// debug routine, dump the stacked casper steps
function dump_steps(msg) {
    this.echo("Steps@ " + msg);
    utils.dump(this.steps.map(function (step) {
        return step.toString();
    }));
}

// Logging function to send messages and events back to server.
// See event loggers at the end of this file.
var log_message = function (type, msg, data) {
    //if (type == 'debug') {
    //    return;
    //};
    if (live && type == 'debug') {
        return;
    }
    if (typeof data == 'undefined') {
        data = {};
    }
    var logdata = {
        'message': msg
    };
    if (live || test_log) {
        logdata.data = data;
        var logargs = {
            'activity_type': type,
            'info': JSON.stringify(logdata)
        };
        err = casper.evaluate(function log(log_url, args) {
            try {
                __utils__.sendAJAX(log_url, 'POST', args, true);
                return null;
            } catch (err) {
                return err;
            }
        }, fracbot_log_url, logargs);
        if (err) {
            casper.echo('Logging error:');
            utils.dump(err);
            casper.echo(type + ':');
            utils.dump(logdata);
        }
    }
    if (!live || test_log) {
        if (data.toString() != '{}') {
            logdata.data = data;
        }
        casper.echo(type + ':');
        utils.dump(logdata);
    }
};

// Get command line information for task record.
var proxy_ip = casper.cli.options.ip;
if (typeof proxy_ip == 'undefined') {
    proxy_ip = 'none';
}
var client_id = casper.cli.options.id;
if (typeof client_id == 'undefined') {
    client_id = 'none';
}

// Lifetime management
var lifetime = casper.cli.options.lifetime;
if (typeof lifetime != 'undefined' && lifetime > 0) {
    var lifetimer = setInterval(
        function () {
            headless_exit(1, "Lifetime has expired.");
        },
        lifetime * 60000);
} else {
    lifetime = 'unlimited';
}

// Browser events
// This is a mechanism to signal from browser to casper.
// In the browser we log a console message with key text.  
// Here, event code reads log messages looking for the key text
// and sets a flag or increments a count when observed.
var all_pages_done = false;
var page_is_updated = false;
var upload_success = 0;
var upload_success_total = 0;
var upload_error = 0;
var upload_error_total = 0;
casper.on('remote.message', function on_msg(msg) {
    if (msg == 'all_pages_done') {
        all_pages_done = true;
    }
    if (msg == 'page_is_updated') {
        page_is_updated = true;
    }
    if (msg == 'pdf_upload_success') {
        upload_success += 1;
        upload_success_total += 1;
    }
    if (msg == 'pdf_upload_error') {
        upload_error += 1;
        upload_error_total += 1;
    }
});
// The waitFor functions wrap the flag operations in a parameterless
// function that also resets the flag.
function waitForAllPagesDone() {
    this.waitFor(function check_all_pages_done() {
        if (all_pages_done || skip_task) {
            //this.echo("All pages are done.");
            all_pages_done = false;
            return true;
        }
        return false;
    }, null, null, 300000); // give it 5 min. to complete all pages.
    //}, null, null, 3600000);    // give it an hour to complete all pages.
}

function waitForPageUpdate() {
    this.waitFor(function check_page_update() {
        if (page_is_updated || skip_task) {
            //this.echo("Page is updated.");
            page_is_updated = false;
            return true;
        }
        return false;
    });
}

// Common exit function
var headless_exit = function (val, msg) {
    // exit 0 when assigned a null task (mission complete)
    // exit 1 when lifetime expires
    // exit 11-19 for communication errors with skytruth
    // exit 21-29 for communication errors with fracfocusdata
    if (val > 1) {
        msg_type = 'error';
    } else {
        msg_type = 'info';
    }
    if (task_params) {
        task_params.upload_success = upload_success;
        task_params.upload_error = upload_error;
        task_params.task_end_time = new Date().toString();
        log_message("info", "Task interrupted.", task_params);
    }
    log_message(msg_type, 'Ending headless scraper execution.', {
        'exit_status': val,
        'exit_msg': msg,
        'scrape_end_time': new Date().toString(),
        'upload_success_total': upload_success_total,
        'upload_error_total': upload_error_total,
        'search_timeouts': timeout_count
    });

    casper.exit(val);
};

// Static tasks for testing:
var static_task = 0;
var static_params = [
    //{ state_name: "Florida",                                },   // No wells in state
    //{ state_name: "Nebraska",                               },   // Single page state
    //{ state_name: "Michigan",                               },   // Single page state
    //{ state_name: "Alabama",                                },   // 3-page state
    //{ state_name: "Alaska",                                 },   // 3-page state
    //{ state_name: "Virginia",                               },   // 6-page state
    { state_name: "Texas",        county_name: "Aransas"    }, // No wells in county
    { state_name: "Oklahoma",     county_name: "Osage"      }, // Single page county
    { state_name: "Colorado",     county_name: "Broomfield" }, // 2 page county
    //{ state_name: "Colorado",     county_name: "Larimer"    },   // 3 page county
    //{ state_name: "Pennsylvania", county_name: "Tioga"      },   // 17 page county
    false
];

var task_params;

    function get_task() {
        if (live || test_task) {
            params = this.evaluate(function task(task_url) {
                try {
                    return JSON.parse(
                        __utils__.sendAJAX(task_url, 'GET', null, false));
                } catch (err) {
                    return {
                        'error': err
                    };
                }
            }, fracbot_task_url);
        } else {
            params = static_params[static_task];
            static_task += 1;
        }
        if (params) {
            task_params = params;
            params.task_start_time = new Date().toString();
            params.lifetime = lifetime;
            params.client = client_id;
            params.proxy = proxy_ip;
            if (params.error) {
                var error = params.error;
                params.error = params.error.message;
                log_message("error", "Abort: Task ajax error.", error);
                if (error.code == 101) {
                    headless_exit(11, "AJAX NETWORK_ERR 101 on task request");
                } else {
                    headless_exit(12, "ERROR on task request");
                }
            }
            if (params.county_name) {
                log_message("info", "Task received: " + params.county_name +
                    ", " + params.state_name, params);
            } else {
                log_message("info", "Task received: " + params.state_name,
                    params);
            }
        }
        return params;
    }

    function scrape_page() {
        if (live || test_update) {
            log_message('debug', 'Passing search results to fracbot.');
            this.evaluate(function all_pages() {
                downloadAllPages(function finish_cb() {
                    console.log("all_pages_done")
                });
            });

            waitForAllPagesDone.call(this);
            this.then(function () {
                log_message('debug', 'Download complete.');
            });
        } else {
            var rows = this.evaluate(function one_page() {
                return parseRows();
            });
            utils.dump(rows);
        }
    }

    function search_stacker(params) {
        this.then(function state() {
            state_num = this.getElementAttribute(
                xpath("//select[@id='MainContent_cboStateList']/option[.='" +
                    params.state_name + "']"), 'value');
            log_message('debug', "Setting state to " + state_num);
            params.state_api_num = state_num
            //this.echo('Selecting state ' + params.state_name + " (" + state_num + ")");
            this.evaluate(function set_state(state) {
                jQuery("#MainContent_cboStateList").val(state);
                jQuery("#MainContent_cboStateList").trigger("change");
            }, state_num);
        });

        this.waitFor(function check_county() {
            if (skip_task) { return true; }
            return 'Choose a County' == this.getFormValues('form').ctl00$MainContent$cboCountyList;
        });
        this.then(function () {
            if (skip_task) {
                headless_exit(22, "Error selecting state " + state_num);
            }
            log_message('debug', "State set to " + state_num);
        });

        if (params.county_name) {
            this.then(function county() {
                county_num = this.getElementAttribute(
                    xpath(
                        "//select[@id='MainContent_cboCountyList']/option[.='" +
                        params.county_name + "']"),
                    'value');
                log_message('debug', "Setting county to " + county_num);
                params.county_api_num = county_num
                //this.echo('Selecting county ' + params.county_name + ' (' + county_num + ')');
                this.evaluate(function set_county(county) {
                    jQuery("#MainContent_cboCountyList").val(county);
                    jQuery("#MainContent_cboCountyList").trigger(
                        "change");
                }, county_num);
                log_message('debug', "County set to " + county_num);
            });

            this.waitFor(function check_well() {
                if (skip_task) { return true; }
                return 'Choose a Well Name' == this.getFormValues('form').ctl00$MainContent$cboWellNameList;
            });
            this.then(function () {
                if (skip_task) { headless_exit(23, "Error on search request."); }
            });
        }

        this.then(function submit() {
            log_message('debug', "Submit search", params);
            this.click(sel_search_btn);
        });

        this.waitForUrl(results_url);
        this.then(function () {
            if (skip_task) { headless_exit(24,
                "Error when waiting for search results."); }
        });
        waitForPageUpdate.call(this);
        this.then(function () {
            if (skip_task) { headless_exit(13, "Error when updating pages."); }
        });

        this.then(function scrape_pages() {
            //this.echo('Scraping pages');
            scrape_page.call(this);
        });
        this.then(function () {
            if (skip_task) {
                //headless_exit(14, "Error when scraping pages.");
                // Continue on pdf scrape error.
                skip_task = false;
            }
        });
    }

    function page_stacker() {
        var page = this.getElementAttribute(sel_page_num, 'value');
        log_message('debug', "page_stacker: stacking page " + (Number(page) + 1));
        this.then(function request_page() {
            this.click(sel_next_btn);
        });
        this.waitForSelectorTextChange(xpath(
            "//input[@id='MainContent_GridView1_PageCurrent']/@value"));
        this.then(function scrape_next() {
            this.echo('Scraping next page');
            scrape_page.call(this);
        });
    }

    function scrape_loop() {
        // Implements a recursive loop over assigned tasks in the fashion of
        // https://github.com/n1k0/casperjs/blob/master/samples/dynamic.
        if (!skip_task && !live && !test_update && this.exists(sel_next_btn)) {
            // note: 'live' or 'test_update' implies use of downloadAllPages
            //       so we don't page here.
            this.start();
            page_stacker.call(this);
            //dump_steps.call(this, 'page stack');
        } else {
            // Finish old task
            if (task_params) {
                task_params.upload_success = upload_success;
                task_params.upload_error = upload_error;
                task_params.timeout_count = timeout_count;
                task_params.task_end_time = new Date().toString();
                if (skip_task) {
                    log_message("info", "Task failed -- request timed out.",
                        task_params);
                    task_params = null;
                } else {
                    log_message("info", "Task complete", task_params);
                    task_params = null;
                }
            }
            // Start a new task
            skip_task = false;
            timeout_count = 0;
            upload_success = 0;
            upload_error = 0;
            this.start(search_url);
            if (skip_task) { headless_exit(21,
                "Error on request for fracfocus search form."); }
            task_params = get_task.call(this);
            if (task_params) {
                search_stacker.call(this, task_params);
                //dump_steps.call(this, 'task stack');
            } else {
                headless_exit(0, "Null task assigned.");
            }
        }
        this.run(scrape_loop);
    }

casper.start();
casper.then(function () {
    log_message("info", "Starting headless scraper execution.", {
        "scrape_start_time": new Date().toString(),
        "scraper_lifetime": lifetime.toString() + " minutes",
        "proxy": proxy_ip
    });
});
casper.run(scrape_loop);

// Event loggers
// See http://docs.casperjs.org/en/latest/events-filters.html
//     for list of reportable events.
// Events generate log messages at 'error' or 'debug' levels.
casper.on('exit', function (status) {
    log_message('debug', "Casper exits.  Status: " + status);
});
casper.on('step.error', function (err) {
    log_message("error", "Step function error: " + err);
});
casper.on("complete.error", function (err) {
    log_message('error', "Error in complete function: " + err);
});
casper.on('error', function (msg, backtrace) {
    logmsg = "Uncaught error: " + msg;
    logdata = {
        "traceback": backtrace
    };
    log_message("error", logmsg, logdata);
});

casper.on('timeout', function () {
    log_message('error', "script execution timeout.");
});
casper.on('step.timeout', function () {
    log_message('error', "navigation step timeout.");
});

