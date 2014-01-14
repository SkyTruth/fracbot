# -*- coding: utf-8 -*-
"""
Created on Tue Nov 19 10:32:02 2013

@author: Craig
"""

# standard modules
import argparse
import random
import subprocess
import time

#import sys
import threading

# site modules

# local modules

# CONSTANTS


# GLOBALS
job_timeout = False
bot_warning_received = False
verbose = False

def get_exit_status(log):
    i0 = log.rfind('"exit_status": ')
    if i0 < 0:
        return None
    i1 = i0 + 15
    i2 = log.find(',', i1)
    status = int(log[i1:i2])

    if status == 5:
        global bot_warning_received
        bot_warning_received = True
    return status

def expire_job():
    global job_timeout
    job_timeout = True

def run_scraper(lifetime=0, tasklimit=0, proxy_addr=None, proxy_type=None):
    if proxy_addr:
        proxy1 = "--proxy={} {} ".format(proxy_addr, proxy_type)
        proxy2 = "--ip={} ".format(proxy_addr)
    else:
        proxy1 = ""
        proxy2 = ""
    cmd = ("casperjs "
           "{}"
           #"--disk-cache=yes "
           "--web-security=no "
           "headless-scrape.js "
           "--lifetime={} "
           "--tasklimit={} "
           "{}"
           "--id=headless_driver "
           .format(proxy1, lifetime, tasklimit, proxy2))
    # Fire off a job and wait for results.
    if verbose:
        print "Scraper command:", cmd
    try:
        log = subprocess.check_output(cmd.split(), stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as e:
        # This occcurs when the program exits with non-zero status.
        # Fracbot uses non-zero status frequenty, but no cause to quit.
        log = e.output
    if verbose:
        print "Scraper log:", log
    status = get_exit_status(log)
    if verbose:
        print "Scraper exit status:", status, "\n"

def get_args():
    parser = argparse.ArgumentParser(
            description=
            'headless_driver executes the fracbot headless-scrape.js scraper '
            'using command-line specified arguments.  These can include '
            'scraper task and time limits and operation through one or more '
            'proxies specified in proxy_list.py.  The driver itself can be '
            'constrained by number of scraper runs and total elapsed time.'
            )

    parser.add_argument('-v',
                        dest='verbose',
                        action='store_true',
                        default=False,
                        help='Enables debug output to log'
                       )

    parser.add_argument('--scraper-lifetime',
                        type=int,
                        default=0,
                        help='Lifetime in minutes for each scraper run.  '
                             'Default is 0 for unlimited run time.'
                       )

    parser.add_argument('--tasklimit',
                        type=int,
                        default=0,
                        help='Number of scrape tasks to perform '
                             'per scraper run.  '
                             'Default is 0 for unlimited tasks per run.'
                       )

    parser.add_argument('--proxy-mode',
                        choices=('none', 'inorder', 'random', 'first'),
                        default='none',
                        help='Route requests via proxy from proxy_list.py.  '
                             'Cycle through the proxy list to complete '
                             'the specified number of runs.  '
                             "'none': no proxy;  "
                             "'inorder': use proxies in list order;  "
                             "'random': randomize the proxy list;  "
                             "'first': Use only the first proxy entry.  "
                             "Default is 'none'."
                       )

    parser.add_argument('--job-lifetime',
                        type=int,
                        default=0,
                        help='Lifetime in minutes for job '
                             '(all scraper runs combined).  '
                             'Final run will complete before exit.  '
                             'Default is 0 for unlimited job time.'
                       )

    parser.add_argument('--runlimit',
                        type=int,
                        default=0,
                        help='Number of scraper executions to perform.  '
                             'Default is 0 for unlimited scrapes.'
                       )

    parser.add_argument('--runinterval',
                        type=int,
                        default=0,
                        help='Number of seconds to wait between starting '
                             'scraper runs.  '
                             'Default is 0.'
                       )

    args = parser.parse_args()
    return args

def main():
    args = get_args()
    global verbose
    verbose = args.verbose

    # Job control
    joblife = args.job_lifetime
    runinterval = args.runinterval
    runlimit = args.runlimit
    if runlimit <= 0:
        runlimit = 999999
    runcount = 0

    # Scraper arguments
    proxy_mode = args.proxy_mode
    scraperlife = args.scraper_lifetime
    tasklimit = args.tasklimit
    proxy_mode = args.proxy_mode
    if proxy_mode == 'none':
        proxies = []
    else:
        import proxy_list
        proxies = list(proxy_list.proxies)
    num_proxies = 1 if proxy_mode == 'first' else len(proxies)

    # set job lifetime expiration timer.
    if joblife > 0:
        if verbose:
            print "Job lifetime {} minutes.".format(joblife)
        t = threading.Timer(joblife*60, expire_job)
        t.start()

    # randomize proxy list if requested
    if proxy_mode == 'random':
        random.shuffle(proxy_list.proxies)

    start_time = None

    while (runcount < runlimit and 
           not job_timeout and
           not bot_warning_received
          ):
        # Implement runinterval
        current_time = time.time()
        if start_time:
            delay = (start_time + runinterval) - current_time
            if delay > 0.:
                time.sleep(delay)
        start_time = time.time()

        # Implement proxy routing.
        if proxy_mode == 'none':
            proxy_addr = proxy_type = None
        else:
            ip, port, protocal = proxies[runcount%num_proxies]
            proxy_addr = "{}:{}".format(ip, port)
            if protocal.lower().startswith('socks'):
                proxy_type = ' --proxy-type=socks5 '
            else:
                proxy_type = ''

        # Run the job.
        runcount += 1
        run_scraper(scraperlife, tasklimit, proxy_addr, proxy_type)

    if verbose:
        if job_timeout:
            print ("headless_driver exiting -- job lifetime ({}) expired."
                   .format(joblife))
        elif runcount >= runlimit:
            print ("headless_driver exiting -- run limit ({}) reached."
                   .format(runlimit))
        elif bot_warning_received:
            print ("headless_driver exiting -- "
                   "BotWarning page received from FracFocus.")
        else:
            print "headless_driver exiting -- ?"

if __name__ == '__main__':
    main()
