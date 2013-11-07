// Dependencies
// http://phantomjs.org/
// http://casperjs.org/

// usage:
//  casperjs headless-scrape.js

var live = false;          // Use fracbotserver for all operations
var test_task = true;     // Use fracbotserver for task assignment
var test_log = true;      // Send log messages to fracbotserver
var test_update = true;   // Call downloadAllPages to update PDFs to fracbotserver

var fracbot_url = "http://ewn4.skytruth.org/fracbot/";
var fracbot_js_url = fracbot_url+'fracbot.user.js';
var fracbot_task_url = fracbot_url+'task';
var fracbot_log_url = fracbot_url+'client-log';
var search_url = 'http://www.fracfocusdata.org/DisclosureSearch/StandardSearch.aspx';
var results_url = '/DisclosureSearch/SearchResults.aspx';
//var sel_state_list = "#MainContent_cboStateList";
//var sel_county_list = "#MainContent_cboCountyList";
var sel_search_btn = "#MainContent_btnSearch";
var sel_next_btn = "input#MainContent_GridView1_ButtonNext";
var sel_page_num = "input#MainContent_GridView1_PageCurrent";

var utils = require('utils');
var xpath = require('casper').selectXPath;

// skip_task is used after a timeout
var skip_task = false;

if (live) {
    var casper = require('casper').create({
        verbose:false,
        log_level:'info',
        waitTimeout:120000,
        onWaitTimeout: function(){
            log_message('error', 'Request timeout.');
            wait(10000);
            skip_task = true;
            },
        remoteScripts: [
            fracbot_js_url 
        ]});
} else {
    var casper = require('casper').create({
        verbose:true,
        log_level:'debug',
        waitTimeout:120000,
        onWaitTimeout: function(){
            log_message('error', 'Request timeout.');
            wait(10000);
            skip_task = true;
            },
        clientScripts: [
            'fracbot.js'
        ]
        });
}

// debug routine, dump the stacked casper steps
function dump_steps(msg) {
    this.echo("Steps@ "+msg);
    utils.dump(this.steps.map(
            function(step) {return step.toString();}
            )
    );
}

// Logging function to send messages and events back to server.
// See event loggers at the end of this file.
var log_message = function(type, msg, data) {
    if (live && type == 'debug') {
        return
    }
    if (typeof data == 'undefined') { data = {}; }
    var logdata = {'message':msg};
    if (live || test_log) {
        logdata.data = data;
        var logargs = {'activity_type':type,
                       'info':JSON.stringify(logdata)
                      };
        err = casper.evaluate( function log(log_url, args) {
            var data = JSON.stringify(args);
            try {
                __utils__.sendAJAX(log_url, 'POST', args, true);
                return null
            } catch(err) {
                return err;
            }
        }, fracbot_log_url, logargs);
        if (err) {
            casper.echo('Logging error:');
            utils.dump(err);
            casper.echo(type+':');
            utils.dump(logdata);
        }
    }
    if ( !live || test_log) {
        if (JSON.stringify(data) != '{}') {
            logdata.data = data;
        }
        casper.echo(type+':');
        utils.dump(logdata);
    }
};

// lifetime management
var lifetime = casper.cli.options.lifetime;
casper.echo("Setting lifetime to "+lifetime+" minutes.");
casper.echo("Setting lifetime to "+lifetime*60000+"ms.");
if (typeof lifetime != 'undefined') {
    //log_message("info", "Setting lifetime for "+lifetime+" minutes.");
    var lifetimer = setInterval(
        function () {
            log_message("info", "Lifetime has expired.");
            casper.exit(0);
        },
        lifetime*60000); 
}

// Static tasks for testing:
var static_task = 0;
var static_params = [
        //{ state_name: "Florida",                                },   // No wells in state
        //{ state_name: "Nebraska",                               },   // Single page state
        //{ state_name: "Michigan",                               },   // Single page state
        //{ state_name: "Alabama",                                },   // 3-page state
        //{ state_name: "Alaska",                                 },   // 3-page state
        //{ state_name: "Virginia",                               },   // 6-page state
          { state_name: "Texas",        county_name: "Aransas"    },   // No wells in county
          { state_name: "Oklahoma",     county_name: "Osage"      },   // Single page county
          { state_name: "Colorado",     county_name: "Broomfield" },   // 2 page county
        //{ state_name: "Colorado",     county_name: "Larimer"    },   // 3 page county
        //{ state_name: "Pennsylvania", county_name: "Tioga"      },   // 17 page county
        false,
        ];

function get_task() {
    if (live || test_task) {
        params = this.evaluate( function task(task_url) {
            try {
                return JSON.parse(
                        __utils__.sendAJAX(task_url, 'GET', null, false));
            } catch(err) {
                return {'error': err};
            }
        }, fracbot_task_url);
    } else {
        params = static_params[static_task];
        static_task += 1;
    }
    if (params) {
        if (params.error) {
            log_message("error", "Task ajax error: " + params.error.message, params.error);
            params = false;
        }
        if (params.county_name) {
            log_message("info", "Task received: "+params.county_name+", "+params.state_name, params);
        } else{
            log_message("info", "Task received: "+params.state_name, params);
        }
    }
    return params;
}

// This is a mechanism to signal from browser to casper.
// In the browser we log a message with key text.  
// Event code in the casper space reads log messages 
// looking for the key text and sets a flag when observed.
// The waitFor function wraps the whole thing is a parameterless
// function that also resets the flag.
var all_pages_done = false;
casper.on('remote.message', function on_msg(msg) {
    if (msg == 'all_pages_done') {all_pages_done=true;}
});
function waitForAllPagesDone() {
    this.waitFor( function check_all_pages_done() {
        if (all_pages_done) {
            this.echo("All pages are done.");
            all_pages_done = false;
            return true;
        }
        return false;
    }, null, null, 3600000);    // give it an hour to complete all pages.
}
// Another console.log signal from browser space.
var page_is_updated = false;
casper.on('remote.message', function on_msg(msg) {
    if (msg == 'page_is_updated') {page_is_updated=true;}
});
function waitForPageUpdate() {
    this.waitFor( function check_page_update() {
        if (page_is_updated) {
            this.echo("Page is updated.");
            page_is_updated = false;
            return true;
        }
        return false;
    });
}

function scrape_page() {
    if (live || test_update) {
        log_message('debug', 'Passing search results to fracbot.');
        this.evaluate( function all_pages() {
            downloadAllPages(function finish_cb() {
                console.log("all_pages_done")
            });
        });

        waitForAllPagesDone.call(this);
        this.then( function(){log_message('info', 'Download complete.');});
    } else {
        var rows = this.evaluate( function one_page() {
            return parseRows();
        });
        utils.dump (rows);
    }
}

function search_stacker(params) {
    this.then( function state() {
        state_num = this.getElementAttribute(
                xpath("//select[@id='MainContent_cboStateList']/option[.='"+params.state_name+"']"), 'value');
        this.echo('Selecting state ' + params.state_name + " (" + state_num + ")");
        this.evaluate( function set_state(state) {
            jQuery("#MainContent_cboStateList").val(state);
            jQuery("#MainContent_cboStateList").trigger("change");
        }, state_num);
    });

    this.waitFor(function check_county() {
        return 'Choose a County' == this.getFormValues('form').ctl00$MainContent$cboCountyList;
    });

    if (params.county_name) {
        this.then(function county() {
            county_num = this.getElementAttribute(
                    xpath("//select[@id='MainContent_cboCountyList']/option[.='"+params.county_name+"']"),
                    'value');
            this.echo('Selecting county ' + params.county_name + ' (' + county_num + ')');
            this.evaluate( function set_county(county) {
                jQuery("#MainContent_cboCountyList").val(county);
                jQuery("#MainContent_cboCountyList").trigger("change");
            }, county_num);
        });

        this.waitFor(function check_well() {
            return 'Choose a Well Name' == this.getFormValues('form').ctl00$MainContent$cboWellNameList;
        });
    }

    this.then(function submit() {
        this.echo('Submitting the search ');
        this.click(sel_search_btn);
    });

    this.waitForUrl(results_url);
    waitForPageUpdate.call(this);

    this.then(function scrape_pages() {
        this.echo('Scraping pages');
        scrape_page.call(this);
    });
}

function page_stacker() {
    var page = this.getElementAttribute(sel_page_num, 'value');
    log_message('debug', "page_stacker: stacking page " + (Number(page)+1));
    this.then( function request_page() {
        this.click(sel_next_btn);
    });
    this.waitForSelectorTextChange(xpath("//input[@id='MainContent_GridView1_PageCurrent']/@value"));
    this.then(function scrape_next() {
        this.echo('Scraping next page');
        scrape_page.call(this);
    });
}

var task_params
function scrape_loop() {
    // Implements a recursive loop over assigned tasks in the fashion of
    // https://github.com/n1k0/casperjs/blob/master/samples/dynamic.
    if ( !skip_task && !live && !test_update && this.exists(sel_next_btn)) {
        // note: live or test_update implies use of downloadAllPages so we don't page here.
        this.start();
        page_stacker.call(this);
        //dump_steps.call(this, 'page stack');
    } else {
        if (task_params)  {
            if (skip_task) {
                log_message("info", "Task failed -- request timed out.", task_params);
            } else {
                log_message("info", "Task complete", task_params);
            }
        }
        skip_task = false
        this.start(search_url);
        if (!skip_task) {
            task_params = get_task.call(this);
            if (task_params) {
                search_stacker.call(this, task_params);
                //dump_steps.call(this, 'task stack');
            } else {
                log_message("info", "Null task assigned.  Exiting.", {});
                this.exit(0)
            }
        }
    }
    this.run(scrape_loop);
}

casper.start();
casper.then( function() {
    this.echo('Starting Scrape');
    log_message("info", "Set lifetime for "+lifetime+" minutes.");
});
casper.run(scrape_loop);

// Event loggers
// See http://docs.casperjs.org/en/latest/events-filters.html
//     for list of reportable events.
// Events generate log messages at 'error', 'info' or 'debug' levels.
casper.on('error', function(msg, backtrace) {
    logmsg = "Uncaught error: " + msg;
    logdata = {"traceback":backtrace, };
    log_message("error", logmsg, logdata);
});
casper.on('step.error', function(err) {
    log_message("error", "Step function error: " + err);
});
casper.once("complete.error", function(err) {
    log_message('error', "Error in complete function: " + err);
});
casper.once("page.error", function(msg, trace) {
    logmsg = "Javascript error: " + msg;
    logdata = {"traceback":trace, };
    log_message("error", logmsg, logdata);
});

casper.on('timeout', function(){
    log_message('error', "script execution timeout.");
});
casper.on('step.timeout', function(){
    log_message('error', "navigation step timeout.");
});
casper.on("waitFor.timeout", function(){
    log_message('error', "wait* operation timeout.");
});

casper.on('resource.received', function(resource) {
    logmsg = "Resource received from "+resource.url;
    logdata = {'url':resource.url,
               'status':resource.status,
               'statusText':resource.statusText,
              };
    if (resource.status > 399) {
        // logging error on log url can lead to infinite loop.
        if (resource.url != fracbot_log_url) {
            log_message("error", logmsg, logdata);
        } else {
            utils.dump(logdata)
        }
    } else {
        //log_message("debug", logmsg, logdata);  // dumps too much stuff
    }
});
casper.on('navigation.requested', function(url, navigationType, navigationLocked, isMainFrame) {
    logmsg = "Navigation requested to "+url;
    logdata = {'url':url,
               'type':navigationType,
               'locked':navigationLocked,
               'mainFrame':isMainFrame};
    //log_message("debug", logmsg, logdata);  // Too much output
});
casper.on('step.added', function(status) {
    logmsg = "Casper step added. "+status.substring(0,80);
    logdata = {'status':status};
    log_message("debug", logmsg, logdata);
});
casper.on('exit', function(status) {
    log_message('debug', "Casper exits.  Status: " + status);
});
casper.on('entry', function(status) {
    log_message(entry.level, entry.message, entry);
});
