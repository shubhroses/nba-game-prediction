"""
Scheduled capture of the sportsbook consensus for upcoming NBA games.

    python -m pipeline snapshot --all --data-dir DIR

pipeline/README.md describes the job and the files it publishes. The package
uses the standard library only and needs Python 3.11 or newer.
"""

import sys

if sys.version_info < (3, 11):
    # This is not only about syntax. Before 3.11, datetime.fromisoformat does
    # not accept the "Z" that ends the provider's times, so every game would
    # be dropped for having no usable start time and the board would be empty.
    raise RuntimeError("The pipeline needs Python 3.11 or newer.")
