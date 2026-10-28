//! Screen capture through the xdg-desktop-portal ScreenCast interface with an
//! embedded cursor, delivering I420 frames scaled to a requested size.

pub mod cpu;
pub mod formats;
pub mod geometry;
pub mod gpu;
pub mod stream;
