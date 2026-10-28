"""Fullscreen window for the stale-frame live test.

Shows a white bar that moves right at a constant, clock-based speed over a
dark background, fullscreen on the monitor with the given connector, and
quits after the given number of seconds. The bar is a CSS-styled widget, so
GTK draws it on the GPU and the window keeps up with the monitor's refresh
rate.

Usage: python3 moving_bar.py <connector> <seconds>
"""

import sys
import time

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

CONNECTOR = sys.argv[1]
SECONDS = float(sys.argv[2])
SPEED = 0.25
BAR_WIDTH = 0.04
STYLE = "window, fixed { background: #1a1a1a; } .bar { background: #ffffff; }"


def find_monitor(connector):
    """Returns the monitor with the given connector name, or None."""
    monitors = Gdk.Display.get_default().get_monitors()
    for index in range(monitors.get_n_items()):
        monitor = monitors.get_item(index)
        if monitor.get_connector() == connector:
            return monitor
    return None


def on_activate(app):
    """Opens the fullscreen window and schedules the quit."""
    start = time.monotonic()
    provider = Gtk.CssProvider()
    provider.load_from_string(STYLE)
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    window = Gtk.ApplicationWindow(application=app, title="gimodi stale frame test")
    fixed = Gtk.Fixed()
    bar = Gtk.Box()
    bar.add_css_class("bar")
    fixed.put(bar, 0, 0)

    def tick(widget, _clock):
        width, height = widget.get_width(), widget.get_height()
        travel = (time.monotonic() - start) * SPEED % (1.0 - BAR_WIDTH)
        bar.set_size_request(int(BAR_WIDTH * width), height)
        widget.move(bar, int(travel * width), 0)
        return GLib.SOURCE_CONTINUE

    fixed.add_tick_callback(tick)
    window.set_child(fixed)
    monitor = find_monitor(CONNECTOR)
    if monitor is None:
        sys.exit(f"monitor {CONNECTOR} not found")
    window.fullscreen_on_monitor(monitor)
    window.present()
    GLib.timeout_add(int(SECONDS * 1000), app.quit)


application = Gtk.Application(application_id="dev.gimodi.StaleFrameTest")
application.connect("activate", on_activate)
application.run([])
