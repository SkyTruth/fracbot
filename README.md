FracFocus Headless Scraper
Installation and operation guide

Introduction
------------
The FracFocus Headless Scraper (FFHeadless) is a the client side of a web 
application that scrapes data from fracfocusdata.com on hydraulic fracture 
drilling and the chemicals used in the process.

FFHeadless is built on top of PhantomJS (phantomjs.org), a 'headless browser' 
or scriptable WebKit as they call themselves.  This software interacts with 
the internet in the same way as a browser but without rendering any graphical 
representations of the pages.  Therefore, FFHeadless can run unattended as 
a background task while it conducts web searches, and downloads and 
forwards pdf files to the skytruth server.

FFHeadless uses CasperJS as a higher level navigation scripting layer to 
drive PhantomJS.  The user will only interact directly with casperJS.

Requirements
------------
FFHeadless has been tested on Windows 7 and Ubuntu 13.04.  In theory it can 
run any Windows XP or later, any recent Linux, and on Mac XOS as well. 

    PhantomJS:
        Tested with versions 1.9.1 and 1.9.2.
        Current version 1.9.2 at http://phantomjs.org/download.html
    
    CasperJS:
        Tested with several versions.
        On Windows, I suggest using 1.1-beta3 (or later, eg git release)
        Older 1.1 versions work but require a .bat file which is a nuisance.
        On Linux, any 1.1 version will suffice.  
        Latest 1.1-beta3 available at casperjs.org.

    Python 2.6 or later.  Tested with 2.7.2 and 2.7.3. (python.org)
    On Windows: .NET Framework 3.5 or greater (or Mono 2.10.8 or greater) 

Suggested installation procedure
--------------------------------
Note: I use a GNU bash shell on Windows.  A Windows command prompt can do 
the same job but would use Windows commands.

As a user of your choice in the home directory referred to as '~' 
    > cd ~
    > git clone https://github.com/SkyTruth/fracbot
    > mkdir fracbot_dependencies

OK, so technically, this makes 'git' a requirement.
See https://help.github.com/articles/set-up-git for help there.

There should now be two new directories, ~/fracbot and ~/fracbot_dependencies.

From a browser download into ~/fracbot_dependencies:
    https://github.com/n1k0/casperjs/zipball/1.1-beta3
and one of these as appropriate for your machine:
    https://phantomjs.googlecode.com/files/phantomjs-1.9.2-windows.zip
    https://phantomjs.googlecode.com/files/phantomjs-1.9.2-linux-x86_64.tar.bz2
    https://phantomjs.googlecode.com/files/phantomjs-1.9.2-linux-i686.tar.bz2
    https://phantomjs.googlecode.com/files/phantomjs-1.9.2-macosx.zip

Unzip *.zip using explorer copy/paste or gunzip, and tar -xf *.gz2 
producing directories:
    ~/fracbot_dependencies/phantomjs-1.9.2-<platform>/
    ~/fracbot_dependencies/n1k0-casperjs-<tag>/       # <tag> is a hex string 

On Linux:
    > cd  ~/fracbot_dependencies/phantomjs-1.9.2-<platform>/bin
    > sudo ln -s `pwd`/phantomjs /usr/local/bin/phantomjs
    > cd  ~/fracbot_dependencies/n1k0-casperjs-<tag>/bin
    > sudo ln -s `pwd`/casperjs /usr/local/bin/casperjs
On Windows:
    I find it easiest to copy phantomjs.exe into the casperjs bin directory.
    Then add the single path to the environment variable 'PATH'.
    > cd ~/fracbot_dependencies
    > cp phantomjs-1.9.2-<platform>/bin/phantomjs.exe n1k0-casperjs-<tag>/bin

    Now add the full path of 
        ~/fracbot_dependencies/n1k0-casperjs-<tag>/bin
    to your path.  That is, replace ~ with the actual path to the user's 
    home directory (eg C:/Users/fracbot).  If you are adding this to the 
    end of an existing path, then use a semicolon (;) as a separator 
    before adding your path.
    For help on setting environment variables in Windows, see:
        http://www.computerhope.com/issues/ch000549.htm
        http://www.java.com/en/download/help/path.xml

    Finally, open a new bash window (or command prompt).

Test for succesful installation:
    > cd ~/fracbot
    > phantomjs --version
    1.9.2

    > casperjs --version
    1.1.0-DEV

Running FFHeadless
------------------
In ~/fracbot, the headless scraper is the file headless-scrape.js.  This file
is executed by casperjs.  The general form of the command is

    > casperjs <casper options> headless-scrape.js <FFHeadless options>

There are many casper options which also include phantomJS options. These
are documented at 
    http://docs.casperjs.org/en/latest/cli.html
    http://phantomjs.org/api/command-line.html
Of these I regularly use only '--web-security=no' and even that is not
necessary as the skytruth.org api turns off the CSRF protection.  If you 
are running through a proxy server, there are further necessary options 
as described below.

FFHeadless has two options in non-proxy mode:
    --id=<client identifier>
            Provides an string to go into the log messages that identifies 
            which of possibly many client sites generated the message.  
            This is for server side analysis of client site activity.
    --lifetime=<minutes to execute>
            Sets a runtime limit on the scraper execution.  

The simplest execution would be 
    > casperjs headless-scrape.js
which will run indefinitely.  The command line I usually use for testing is:
    > casperjs --web-security=no headless-scrape.js --lifetime=60

The scraper is currently checked in with debug output turned on.  
It is controlled by the flag in line 10 of headless-scrape.js
    var debug_output = true; 
This can be set to false when output becomes unnecessary.  This probably
should be tied to a command line option.

FFHeadless output
-----------------
The execution loop of FFHeadless gets a task from the skytruth api, 
sets up and executes the search request on the tasked state and county, 
and passes the search results page to fracbot.js (the same code that 
runs under greasemonkey for user-in-the-loop automated scraping).
Output from the scraper run follows this pattern.  Output is generated
as log messages which in debug mode are more detailed and are printed 
to stdout as well as logged to the server.

At the beginning and end of the run there are log messages with time and 
status.  Then for each task there is a 'Task Received' log message at 
the start followed by task status information as the scraping procedes, 
and finally an ending task entry which is either 'Task complete' 
or 'Task failed' if a scraping error occurred, or 'Task interrupted' when 
a fatal condition occurs.

Running FFHeadless through a proxy server
-----------------------------------------
Some development has been done to support running through proxy servers.
There are two casperJS options and one FFheadless option involved.
    --proxy=<ip>:<port>
            casperJS option that provides the ip address of the server.
    --proxy_type=<http|socks>
            casperJS option that provides the proxy protocol.
            'http' for http or https, and 'socks' for socks4 or socks5.
    --ip=<proxy ip>
            FFHeadless option that puts the proxy IP address into log
            messages for server-side analysis of proxy performance.

Some testing has been done with public proxy servers.  A list of servers
can be downloaded from http://www.hidemyass.com/proxy-list/.  A automated 
python driver for multiple proxy sites is included in the fracbot directory:

    > cd ~/fracbot
    > python proxy_driver.py --help
    usage: proxy_driver.py [-h] [-v] [--scraper-lifetime SCRAPER_LIFETIME]
                           [--job-lifetime JOB_LIFETIME]
    
    proxy_driver executes the fracbot headless-scrape.js scraper on a series 
    of proxy servers determined by shuffling the list in proxy_list.py.
    
    optional arguments:
      -h, --help            show this help message and exit
      -v                    Enables debug output to log
      --scraper-lifetime SCRAPER_LIFETIME
                            Lifetime in minutes for each headless run.
                            Each scraper run executes through a different 
                            proxy server. Default is 0 for unlimited run.
      --job-lifetime JOB_LIFETIME
                            Lifetime in minutes for while job (all scraper 
                            runs combined). Default is 0 for unlimited run.

The file proxy_list.py contains proxies downloaded from hidemyass, but 
since these sites change day to day it should be updated before using 
the proxy_driver.  

My experience was that very few sites supported the protocols needed 
by fracfocusdata.org and skytruth.org, and most jobs terminated in
error, typically an AJAX error of some sort.


