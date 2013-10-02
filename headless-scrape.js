// Dependencies
// http://phantomjs.org/
// http://casperjs.org/

// usage:  
//		casperjs headless-scrape.js

var casper = require('casper').create({
    clientScripts:  [
        'fracbot.common.js',      
    ]
});
var utils = require('utils');

// for debugging
// casper.on('resource.received', function(resource) {
//    casper.echo(resource.url);
//});

params = {
	url: 'http://www.fracfocusdata.org/DisclosureSearch/',
	state: 37,
	county: 117
};

casper.echo('Starting Scrape');
utils.dump(params);

casper.start(params.url, function() {
    this.echo('Selecting state ' + params.state);
    this.evaluate( function (state) {
	    $("#MainContent_cboStateList").val(state);
	    $("#MainContent_cboStateList").trigger("change");

    }, params.state);
    

});

casper.waitFor(function check() {
	return 'Choose a County' == this.getFormValues('form').ctl00$MainContent$cboCountyList;
}, function then() {
    this.echo('Selecting county ' + params.county);
    this.evaluate( function (county) {
	    $("#MainContent_cboCountyList").val(county);
	    $("#MainContent_cboCountyList").trigger("change");
    }, params.county);
});

casper.waitFor(function check() {
	return 'Choose a Well Name' == this.getFormValues('form').ctl00$MainContent$cboWellNameList;
}, function then() {
    
    this.echo('Submitting the search ');
    this.click('#MainContent_btnSearch');
});

casper.waitForUrl('/DisclosureSearch/SearchResults.aspx', function () {
	this.echo('Scraping first page');
    var rows = this.evaluate( function () {
    	return parseRows();	
    });
    utils.dump (rows);
});

casper.run();