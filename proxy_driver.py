# -*- coding: utf-8 -*-
"""
Created on Tue Nov 19 10:32:02 2013

@author: Craig
"""

# standard modules
import argparse
import random
import subprocess
#import sys
import threading

# site modules

# local modules
import proxy_list

# CONSTANTS


# GLOBALS
exit_job = False

def get_exit_status(log):
    i0 = log.rfind('"exit_status": ')
    if i0 < 0:
        return None
    i1 = i0 + 15
    i2 = log.find(',', i1)
    status = int(log[i1:i2])
    return status

def job_timeout():
    global exit_job
    exit_job = True
    #sys.exit('Job lifetime has expired.')

def get_args():
    parser = argparse.ArgumentParser(
            description=
            'proxy_driver executes the fracbot headless-scrape.js scraper '
            'on a series of proxy servers determined by '
            'shuffling the list in proxy_list.py.')

    parser.add_argument('-v',
                        dest='verbose',
                        action='store_true',
                        default=False,
                        help='Enables debug output to log'
                       )

    parser.add_argument('--scraper-lifetime',
                        type=int,
                        default=0,
                        help='Lifetime in minutes for each headless run.  '
                             'Default is 0 for unlimited run.'
                       )

    parser.add_argument('--job-lifetime',
                        type=int,
                        default=0,
                        help='Lifetime in minutes for while job '
                             '(all scraper runs combined).  '
                             'Default is 0 for unlimited run.'
                       )
    args = parser.parse_args()
    return args

def main():
    args = get_args()
    verbose = args.verbose
    scraperlife = args.scraper_lifetime
    joblife = args.job_lifetime
    if joblife > 0:
        # set job lifetime expiration timer.
        if verbose:
            print "Job lifetime {} minutes.".format(joblife)
        t = threading.Timer(joblife*60, job_timeout)
        t.start()

    # Start through proxies
    random.shuffle(proxy_list.proxies)
    for ip, port, protocal in proxy_list.proxies:
        # Construct a command to scrape through the proxy
        if protocal.lower().startswith('socks'):
            type_string = ' --proxy-type=socks5 '
        else:
            type_string = ''
        cmd = ("casperjs "
               "--proxy={}:{} {} "
               #"--disk-cache=yes "
               "--web-security=no "
               "headless-scrape.js "
               "--lifetime={} "
               "--ip={}:{} "
               "--id=proxy_driver "
               .format(ip, port, type_string, scraperlife, ip, port))
        # Fire off a job and wait for results.
        if verbose:
            print "Command:", cmd
        log = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        if verbose:
            print "Log:", log
        status = get_exit_status(log)
        if verbose:
            print "Exit status:", status, "\n"
        if exit_job:
            if verbose:
                print "proxy_driver exiting -- job lifetime expired."
            break
    else:
        if verbose:
            print "proxy_driver exiting -- proxy_list exhausted"

if __name__ == '__main__':
    main()
