//! Screen capture through the xdg-desktop-portal ScreenCast interface with an
//! embedded cursor, delivering I420 frames scaled to a requested size.

pub mod capture;
pub mod cpu;
pub mod formats;
pub mod geometry;
pub mod gpu;
mod portal;
pub mod stream;
