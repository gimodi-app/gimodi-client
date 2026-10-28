"""Fullscreen window for the stale-frame live test.

Draws a white bar that moves right at a constant, clock-based speed over a
dark background, fullscreen on the monitor with the given connector, and
quits after the given number of seconds.

Usage: python3 moving_bar.py <connector> <seconds>
"""

import sys
import time

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

CONNECTOR = sys.argv[1]
SECONDS = float(sys.argv[2])
SPEED = 0.25
BAR_WIDTH = 0.04


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
    window = Gtk.ApplicationWindow(application=app, title="gimodi stale frame test")
    area = Gtk.DrawingArea()

    def draw(_area, cr, width, height):
        travel = (time.monotonic() - start) * SPEED % (1.0 - BAR_WIDTH)
        cr.set_source_rgb(0.1, 0.1, 0.1)
        cr.paint()
        cr.set_source_rgb(1.0, 1.0, 1.0)
        cr.rectangle(travel * width, 0, BAR_WIDTH * width, height)
        cr.fill()

    def tick(widget, _clock):
        widget.queue_draw()
        return GLib.SOURCE_CONTINUE

    area.set_draw_func(draw)
    area.add_tick_callback(tick)
    window.set_child(area)
    monitor = find_monitor(CONNECTOR)
    if monitor is None:
        sys.exit(f"monitor {CONNECTOR} not found")
    window.fullscreen_on_monitor(monitor)
    window.present()
    GLib.timeout_add(int(SECONDS * 1000), app.quit)


application = Gtk.Application(application_id="dev.gimodi.StaleFrameTest")
application.connect("activate", on_activate)
application.run([])
