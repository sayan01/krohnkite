#!/usr/bin/env python3
#
# * Requirements:
#   - pyside2
#   - dbus-python
#

import argparse
import sys

from PySide2.QtGui import QKeySequence
import dbus

# TODO: manually syncing key bindings? sucks!
#       split this into a data file, which then can be translated into
#       typescript code or included in other places.
KROHNKITE_DEFAULT_BINDINGS = [
    ("Down/Next"     , "j"      ),
    ("Up/Prev"       , "k"      ),
    ("Left"          , "h"      ),
    ("Right"         , "l"      ),

    ("Move Down/Next", "shift+j"),
    ("Move Up/Prev"  , "shift+k"),
    ("Move Left"     , "shift+h"),
    ("Move Right"    , "shift+l"),

    ("Grow Height"   , "ctrl+j" ),
    ("Shrink Height" , "ctrl+k" ),
    ("Shrink Width"  , "ctrl+h" ),
    ("Grow Width"    , "ctrl+l" ),

    ("Increase"      , "i"      ),
    ("Decrease"      , "d"      ),

    ("Float"         , "f"      ),
    ("Float All"     , "shift+f"),
    ("Cycle Layout"  , "\\"     ),
    ("Set master"    , "return" ),

    ('Tile Layout'    , 't'),
    ('Monocle Layout' , 'm'),
    ('Spread Layout'  , None),
    ('Stair Layout'   , None),
    ('Floating Layout', None),
]

VERBOSE = True


def parse_arguments() -> argparse.Namespace:
    # common arguments
    parser = argparse.ArgumentParser(
        description='A helper script for managing Krohnkite shortcuts')
    parser.add_argument('--quiet', '-q', action='store_true',
        help='Suppress output')

    subparsers = parser.add_subparsers(dest="command",
        help='Commands')

    #
    # register command
    #
    parser_register = subparsers.add_parser('register',
        help='Register Krohnkite-related shortcuts')
    parser_register.add_argument('--bind', '-b', action='append', dest='binds',
        metavar='ACTION=KEY', type=str,
        help='''Use a different key for specified action. The final result is MOD+KEY = ACTION.
        This option can be specified multiple times.''')
    parser_register.add_argument('--force', '-f', action='store_true',
        help='Remove any conflicting shortcuts before registering new ones')
    parser_register.add_argument('--modifier', '-m', default='meta', dest='modifier',
        type=str,
        help='A modifier key to use. Defaults to meta.')

    #
    # unregister command
    #
    parser_unregister = subparsers.add_parser('unregister',
        help='''Remove all Krohnkite shortcuts from KWin.
        This doesn't reset other key bindings changed by this script.''')

    if len(sys.argv) == 1:
        parser.print_help(sys.stderr)
        sys.exit(1)

    return parser.parse_args()

def parse_kvpair(s: str):
    '''Parses simple "A=B"-style expression'''
    return tuple(s.split("=", 2))

def get_keycode(keycomb: str):
    keyseq = QKeySequence.fromString(keycomb)
    return keyseq[0]

def is_key_valid(keycomb: str) -> bool:
    # NOTE: this might be internal detail that should not be accessed.
    return get_keycode(keycomb) != 0x1FFFFFF

def register_krohnkite_shortcut(action: str, keycomb_full: str):
    action = "Krohnkite: " + action
    keycode = get_keycode(keycomb_full)

    if VERBOSE: print("register [{1:<14}] to '{0}'.".format(action, keycomb_full))

    kglobalaccel.setForeignShortcut(["kwin", action, "KWin", ""], [keycode])

def unregister_krohnkite_shortcut(action: str):
    action = "Krohnkite: " + action

    if VERBOSE: print("unregister '{}'.".format(action))

    kglobalaccel.setForeignShortcut(["kwin", action, "KWin", ""], [])

def is_shortcut_colliding(keycomb_full: str) -> bool:
    action_id = kglobalaccel.action(get_keycode(keycomb_full))
    return not not action_id

def unregister_colliding_shortcut(keycomb_full: str):
    action_id = kglobalaccel.action(get_keycode(keycomb_full))
    if len(action_id) > 0:
        if VERBOSE: print("unregister [{:<14}] bound to '{}'".format(keycomb_full, action_id[1]))
        kglobalaccel.setForeignShortcut(action_id, [])

def unregister_all_krohnkite_shortcuts():
    names = [
        str(name) for name
        in kwin_component.shortcutNames()
        if name.startswith('Krohnkite:')
    ]

    for name in names:
        kglobalaccel.unregister("kwin", name)

def is_shortcut_already_bound(keycomb_full: str) -> bool:
    '''Check if the given key combination is already bound to something. '''
    action_id = kglobalaccel.action(get_keycode(keycomb_full))
    return not not action_id

def main():
    config = parse_arguments()

    global VERBOSE
    VERBOSE = False if config.quiet else True

    if config.command == 'register':
        binds = dict(KROHNKITE_DEFAULT_BINDINGS)

        if config.binds is not None:
            # parse ACTION=KEY parameter
            custom_binds = (parse_kvpair(b) for b in config.binds)

            # read-through custom binds
            for action, keycomb in custom_binds:
                if action not in binds:
                    print("invalid action '{}'",format(action))
                    sys.exit(1)
                elif keycomb.lower() == "none":
                    binds[action] = None
                elif is_key_valid(config.modifier + '+' + keycomb):
                    binds[action] = keycomb
                else:
                    print("invalid key '{}' for action '{}'".format(action, keycomb))
                    sys.exit(1)

        if config.force is True:
            for keycomb in binds.values():
                if keycomb is not None:
                    unregister_colliding_shortcut(config.modifier + '+' + keycomb)

        # register shortcuts
        for action, keycomb in binds.items():
            if keycomb is None:
                unregister_krohnkite_shortcut(action)
            else:
                keycomb_full = config.modifier + '+' + keycomb
                if is_shortcut_colliding(keycomb):
                    print("skipping {} due to shortcut collision...".format(keycomb_full))
                else:
                    register_krohnkite_shortcut(action, keycomb_full)

    elif config.command == 'unregister':
        unregister_all_krohnkite_shortcuts()
    else:
        pass


session_bus = dbus.SessionBus()

kglobalaccel_obj = session_bus.get_object('org.kde.kglobalaccel', '/kglobalaccel')
kglobalaccel = dbus.Interface(kglobalaccel_obj, dbus_interface='org.kde.KGlobalAccel')

kwin_component_obj = session_bus.get_object('org.kde.kglobalaccel', '/component/kwin') 
kwin_component = dbus.Interface(kwin_component_obj, dbus_interface='org.kde.kglobalaccel.Component')

if __name__ == '__main__':
    main()

