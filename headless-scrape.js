// Dependencies
// http://phantomjs.org/
// http://casperjs.org/

// usage:  
//		casperjs headless-scrape.js

var live = false;
var search_url = 'http://www.fracfocusdata.org/DisclosureSearch/';
var results_url = '/DisclosureSearch/SearchResults.aspx';
var sel_state_list = "#MainContent_cboStateList";
var sel_county_list = "#MainContent_cboCountyList";
var sel_search_btn = "#MainContent_btnSearch";
var sel_next_btn = "input#MainContent_GridView1_ButtonNext";
var sel_page_num = "input#MainContent_GridView1_PageCurrent";

var casper = require('casper').create({
    verbose:true,
    log_level:'debug',
    waitTimeout:30000,
    clientScripts:  [
        'fracbot_patch.js'
    ],
    remoteScripts: [
        'http://ewn4.skytruth.org/fracbot/fracbot.user.js'
    ]});

var utils = require('utils');

// logging function to send events back to server
var log_message = function(type, msg, data) {
    if (type == '') {
        return
    }
    var logdata = {'message':msg};
    if (live) {
        logdata.data = data;
        var logargs = {'activity_type':type,
                       'info':JSON.stringify(logdata)
                      };
        caster.evaluate(jQuery.post, "http://ewn4.skytruth.org/fracbot/client-log", logargs)
        //jQuery.post("http://ewn4.skytruth.org/fracbot/client-log", logargs);
    } else {
        if (JSON.stringify(data) != '{}') {
            logdata.data = data;
        }
        casper.echo(type+':');
        utils.dump(logdata);
    }
};

// dump the stacked casper steps
function dump_steps(msg) {
    this.echo("Steps@ "+msg);
    utils.dump(this.steps.map(
            function(step) {return step.toString();}
            )
    );
}

// Tasks for testing
var static_task = 0;
var static_params = [
        //{ url: search_url, state: 37, county: 117 },   // Tioga, PA, 17 pages
        //{ url: search_url, state:  9,             },   // FL, No wells in state
        //{ url: search_url, state: 26,             },   // NE, Single page state
        { url: search_url, state:  1,             },   // AL, Multipage state
        { url: search_url, state: 42, county:   7 },   // Aransas, TX, no wells in county
        { url: search_url, state: 35, county: 113 },   // Osage, OK, single page county
        { url: search_url, state:  5, county:  14 },   // Broomfield, CO, 2 pages
        //{ url: search_url, state:  5, county:  69 },   // Larimer, CO, 3 pages
        null,
        ];

function get_task() {
    if (live) {
        log_message("debug", "Here is where we get the task from fracbotserver", {});
    } else {
        params = static_params[static_task];
        static_task += 1;
    }
    return params;
}

function scrape_page() {
    var rows = this.evaluate( function () {
        return parseRows();	
    });
    utils.dump (rows);
}

function stack_search(params) {
    this.then( function state() {
        this.echo('Selecting state ' + params.state);
        this.evaluate( function set_state(state) {
    	    $("#MainContent_cboStateList").val(state);
    	    $("#MainContent_cboStateList").trigger("change");
        }, params.state);
    });
    
    this.waitFor(function check_county() {
    	return 'Choose a County' == this.getFormValues('form').ctl00$MainContent$cboCountyList;
    });

    if (params.county) {
        this.then(function county() {
            this.echo('Selecting county ' + params.county);
            this.evaluate( function set_county(county) {
    	        $("#MainContent_cboCountyList").val(county);
    	        $("#MainContent_cboCountyList").trigger("change");
            }, params.county);
        });
    
        this.waitFor(function check_well() {
    	    return 'Choose a Well Name' == this.getFormValues('form').ctl00$MainContent$cboWellNameList;
        });
    }
        
    this.then(function submit() {
        this.echo('Submitting the search ');
        this.click(sel_search_btn);
    });
    
    this.waitForUrl(results_url)
    
    this.then(function scrape_first() {
    	this.echo('Scraping first page');
        scrape_page.call(this);
    });
}

var xpath = require('casper').selectXPath;
function stack_pager() {
    var page = this.getElementAttribute(sel_page_num, 'value');
    
    log_message('info', "stack_pager: stacking page " + (Number(page)+1), {});
    this.then( function request_page() {
        this.click(sel_next_btn);
    });
    //this.wait(30000);
    //this.waitForSelectorTextChange(xpath("//input@value"));
    this.waitForSelectorTextChange(xpath("//input[@id='MainContent_GridView1_PageCurrent']/@value"));
    //this.waitForSelectorTextChange(xpath("//input[@id='MainContent_GridView1_PageCurrent']@value"));
    //this.waitForSelectorTextChange(sel_page_num+'[value]);
    //this.waitFor(function check_page() {
    //    return this.getElementAttribute(sel_page_num, 'value') == page+1;
    //});
    this.then(function scrape_next() {
    	this.echo('Scraping next page');
        scrape_page.call(this);
    });
}

function scrape_loop() {
    if (this.exists(sel_next_btn)){
        this.start();
        stack_pager.call(this);
        dump_steps.call(this, 'page stack');
        this.run(scrape_loop);
    } else {
        task_params = get_task.call(this);
        if (task_params) {
            this.start(task_params.url);
            utils.dump(task_params);
            stack_search.call(this, task_params);
            dump_steps.call(this, 'task stack');
            this.run(scrape_loop);
        } else {
            this.exit()
        }
    }
    //this.run(scrape_loop);
}

casper.start()
casper.then( function() {
    this.echo('Starting Scrape');
});
casper.run(scrape_loop);

// Event handlers
// See http://docs.casperjs.org/en/latest/events-filters.html
//     for list of reportable events.
casper.on('error', function(msg, backtrace) {
    logmsg = "Uncaught error: " + msg;
    logdata = {"traceback":backtrace,
              };
    log_message("error", logmsg, logdata);
});
casper.on('step.error', function(err) {
    logmsg = "Step function error: " + err;
    logdata = {};
    log_message("error", logmsg, logdata);
});
casper.once("complete.error", function(err) {
    logmsg = "Error in complete function: " + err;
    logdata = {};
    log_message("error", logmsg, logdata);
});
casper.once("page.error", function(msg, trace) {
    logmsg = "Javascript error: " + msg;
    logdata = {"traceback":trace,
              };
    log_message("error", logmsg, logdata);
});

casper.on("waitFor.timeout", function(){
    logmsg = "wait* operation timeout.";
    logdata = {};
    log_message("error", logmsg, logdata);
});
casper.on('resource.received', function(resource) {
    logmsg = "Resource received from "+url;
    logdata = {'url':resource.url,
               'status':resource.status,
               'statusText':resource.statusText,
              };
    if (resource.status > 399) {
        log_message("error", logmsg, logdata);
    } else {
        //log_message("debug", logmsg, logdata);
    }
});
casper.on('navigation.requested', function(url, navigationType, navigationLocked, isMainFrame) {
    logmsg = "Navigation requested to "+url;
    logdata = {'url':url,
               'type':navigationType,
               'locked':navigationLocked,
               'mainFrame':isMainFrame};
    log_message("debug", logmsg, logdata);
});
casper.on('step.added', function(status) {
    logmsg = "Casper step added. "+status.substring(0,80);
    logdata = {'status':status};
    log_message("debug", logmsg, logdata);
});
casper.on('exit', function(status) {
    logmsg = "Casper exits.  Status: " + status;
    logdata = {};
    log_message("debug", logmsg, logdata);
});
casper.on('entry', function(status) {
    log_message(entry.level, entry.message, entry);
});

