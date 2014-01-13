// dependencies
//      http://phantomjs.org/
//      http://casperjs.org/
// usage:
//      casperjs [--web-security=no] headless-scrape.js

// Configuration flags
// Production configuration is live=true, others=false.
var live = true; // Post log and pdfs to fracbot server
var debug_output = true; // Produces more logging records.
var local_fracbot = false; // Use local copy of fracbot.js (for debug)
var local_tasking = false; // Use internal array of tasks (for debug)

// URLs
var fracbot_url = "http://ewn4.skytruth.org/fracbot/";
var fracbot_js_url = fracbot_url + 'fracbot.user.js';
//var fracbot_task_url = fracbot_url + 'task';
var fracbot_task_url = fracbot_url + 'task2';
var fracbot_log_url = fracbot_url + 'client-log';
var search_url =
    'http://www.fracfocusdata.org/DisclosureSearch/StandardSearch.aspx';
var bot_warning_url =
    'http://www.fracfocusdata.org/DisclosureSearch/BotWarning.aspx';
var results_url = '/DisclosureSearch/SearchResults.aspx';

var utils = require('utils');
var xpath = require('casper').selectXPath;

// Execution control flags used in response to timeout events, etc.
var skip_task = false;
var timeout_count = 0;
var timeout_count_total = 0;

// Create casper object
if (local_fracbot) {
    clientScripts = ['fracbot.js'];
    remoteScripts = [];
} else {
    clientScripts = [];
    remoteScripts = [fracbot_js_url];
}
if (debug_output) {
    verbose = true;
    log_level = 'debug';
} else {
    verbose = false;
    log_level = 'info';
}

var casper = require('casper').create({
    verbose: verbose,
    log_level: log_level,
    waitTimeout: 180000,
    onWaitTimeout: function () {
        log_message('error', 'Error: Request timeout.');
        timeout_count += 1;
        timeout_count_total += 1;
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

//casper.on('waitFor.timeout', function (timeout, details) {
//        log_message('error', 'Error: Request timeout after '+timeout+'ms.', data=details);
//        timeout_count += 1;
//        timeout_count_total += 1;
//        skip_task = true;
//        wait(10000);
//});

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
    if (!debug_output && type == 'debug') {
        return;
    }
    if (typeof data == 'undefined') {
        data = {};
    }
    var logdata = {
        'message': msg
    };
    if (live) {
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
    if (debug_output) {
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
            headless_err(1, "Lifetime has expired.", true);
        },
        lifetime * 60000);
} else {
    lifetime = 'unlimited';
}
var tasklimit = casper.cli.options.tasklimit;
if (typeof tasklimit == 'undefined' || tasklimit <= 0) {
    tasklimit == 1000000;
}
var taskcount = 0;

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
    if (msg.substring(0,18) == 'pdf_upload_success') {
        upload_success += 1;
        upload_success_total += 1;
        log_message('debug', msg);
    }
    if (msg.substring(0,16) == 'pdf_upload_error') {
        upload_error += 1;
        upload_error_total += 1;
        log_message('debug', msg);
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
    }, null, null, 600000); // give it 10 min. to complete all pages.
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
var headless_err = function (val, msg, do_exit) {
    // exit 0 when assigned a null task (mission complete)
    // exit 1 when lifetime expires
    // exit 2 when taskcount reaches tasklimit
    // exit 5 when the client IP is temporarily blocked and forwarded to
    //             '/DisclosureSearch/BotWarning.aspx'.
    // exit 11-19 for communication errors with skytruth
    // exit 21-29 for communication errors with fracfocusdata
    if (val > 4) {
        msg_type = 'error';
    } else {
        msg_type = 'info';
    }
    if (do_exit) {
        if (task_params) {
            task_params.upload_success = upload_success;
            task_params.upload_error = upload_error;
            task_params.timeout_count = timeout_count;
            task_params.task_end_time = new Date().toString();
            log_message("info", "Task interrupted by error.", task_params);
        }
        log_message(msg_type, 'Ending headless scraper execution.', {
            'exit_status': val,
            'exit_msg': msg,
            'scrape_end_time': new Date().toString(),
            'searches_performed': taskcount,
            'upload_success_total': upload_success_total,
            'upload_error_total': upload_error_total,
            'timeout_count_total': timeout_count_total
        });

        casper.exit(val);
    }
};

// Static tasks for testing:
var static_task = 0;
var static_params = [
    //{ state_name: "Florida" }, // void state
    //{ state_name: "Nebraska" }, // 1 page state
    //{ state_name: "Michigan" }, // 1 page state
    //{ state_name: "Alabama" }, // 3-page state
    //{ state_name: "Alaska" }, // 3-page state
    //{ state_name: "Virginia" }, // 6-page state
    //{ state_name: "Texas", county_name: "Aransas" }, // void county
    //{ state_name: "Oklahoma", county_name: "Osage" }, // 1 page county
    //{ state_name: "Colorado", county_name: "Broomfield" }, // 2 page county
    { state_name: "Colorado", county_name: "Larimer" }, // 3 page county
    //{ state_name: "Pennsylvania", county_name: "Tioga" }, // 17 page county
    false
];

var task_params;

function get_task() {
    if (!local_tasking) {
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
                headless_err(11, "AJAX NETWORK_ERR 101 on task request", true);
            } else {
                headless_err(12, "ERROR on task request", true);
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
    if (live) {
        log_message('debug', 'Passing search results to fracbot.');
        this.evaluate(function all_pages() {
            downloadAllPages(function finish_cb() {
                console.log("all_pages_done");
            });
        });
        waitForAllPagesDone.call(this);
        this.then(function () {
            if (skip_task) {
                headless_err(14, "Timeout while scraping pages.", false);
            } else {
                log_message('debug', 'Download complete.');
            }
        });
    } else {
        log_message('debug', 'Download skipped -- not live operation.');
    }
}

function search_stacker(params) {
    this.then(function state() {
        state_num = params.state_code;
        if (typeof state_num == 'undefined') {
            state_num = this.getElementAttribute(
                xpath("//select[@id='MainContent_cboStateList']/option[.='" +
                    params.state_name + "']"), 'value');
        }
        //log_message('debug', "Setting state to " + state_num);
        params.state_api_num = state_num;
        this.evaluate(function set_state(state) {
            jQuery("#MainContent_cboStateList").val(state);
            jQuery("#MainContent_cboStateList").trigger("change");
        }, state_num);
    });

    this.waitFor(function check_county() {
        if (skip_task) {
            return true;
        }
        if (this.exists('#MainContent_cboCountyList')) {
            return 'Choose a County' == this.getFormValues('form').ctl00$MainContent$cboCountyList;
        } else {
            return false;
        }
    });
    this.then(function () {
        if (skip_task) {
            headless_err(22, "Error selecting state " + state_num, false);
        } else {
            log_message('debug', "State set to " + state_num);
        }
    });

    if (params.county_name) {
        this.then(function county() {
            if (!skip_task) {
                county_num = params.county_code;
                if (typeof county_num == 'undefined') {
                    county_num = this.getElementAttribute(
                        xpath(
                            "//select[@id='MainContent_cboCountyList']/option[.='" +
                            params.county_name + "']"),
                        'value');
                }
                //log_message('debug', "Setting county to " + county_num);
                params.county_api_num = county_num
                this.evaluate(function set_county(county) {
                    jQuery("#MainContent_cboCountyList").val(county);
                    jQuery("#MainContent_cboCountyList").trigger(
                        "change");
                }, county_num);
            }
        });

        this.waitFor(function check_well() {
            if (skip_task) {
                return true;
            }
            if (this.exists('MainContent_cboWellNameList')) {
                return 'Choose a Well Name' == this.getFormValues('form').ctl00$MainContent$cboWellNameList;
            } else {
                return false;
            }
        });
        this.then(function () {
            if (skip_task) {
                headless_err(23,
                    "Error selecting county " + county_num, false);
            } else {
                log_message('debug', "County set to " + county_num);
            }
        });
    }

    this.then(function submit() {
        if (!skip_task) {
            log_message('debug', "Submit search", params);
            this.click("#MainContent_btnSearch");
            this.waitForUrl(results_url);
            if (skip_task) {
                headless_err(24,
                    "Error when waiting for search results.", false);
            } else {
                waitForPageUpdate.call(this);
                if (skip_task) {
                    headless_err(13, "Error when updating pages.", true);
                }
            }
        }
        if (!skip_task) {
            this.then(function scrape_pages() {
                //this.echo('Scraping pages');
                scrape_page.call(this);
            });
        }
    });
}

function scrape_loop() {
    // Implements a recursive loop over assigned tasks in the fashion of
    // https://github.com/n1k0/casperjs/blob/master/samples/dynamic.
    // Finish old task
    if (task_params) {
        task_params.upload_success = upload_success;
        task_params.upload_error = upload_error;
        task_params.timeout_count = timeout_count;
        task_params.task_end_time = new Date().toString();
        if (skip_task) {
            log_message("info", "Task failed -- scraping error.",
                task_params);
            task_params = null;
        } else {
            log_message("info", "Task complete", task_params);
            task_params = null;
        }
    }
    // Start a new task
    task_params = false
    skip_task = false;
    timeout_count = 0;
    upload_success = 0;
    upload_error = 0;
    if (taskcount >= tasklimit) {
        headless_err(2, "Task count reaches limit ("+tasklimit+").", true);
    }
    taskcount += 1;
    this.start(search_url);
    if (skip_task) {
        headless_err(21, "Error requesting fracfocus search form.", true);
    }
    this.then(function () {
        var url = this.evaluate(function () {
            return document.URL;
        });
        if (url == bot_warning_url) {
            headless_err(5, "Forwarded to BotWarning page!", true);
        }
    });

    task_params = get_task.call(this);
    if (task_params) {
        search_stacker.call(this, task_params);
        //dump_steps.call(this, 'task stack');
    } else {
        headless_err(0, "Null task assigned.", true);
    }
    this.run(scrape_loop); // Note recurrsion through complete function.
}

casper.start();
casper.then(function () {
    log_message("info", "Starting headless scraper execution.", {
        "scrape_start_time": new Date().toString(),
        "scraper_lifetime": lifetime.toString() + " minutes",
        "scraper_tasklimit": tasklimit,
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

