//! Pixel formats shared by PipeWire (SPA) and DRM/EGL.

use pipewire::spa::param::video::VideoFormat;
use pipewire::spa::sys;

/// 32-bit RGB formats the compositor may deliver, named by memory byte order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PixelFormat {
    Bgra,
    Bgrx,
    Rgba,
    Rgbx,
}

/// Builds a DRM fourcc code from its four characters.
const fn fourcc(code: &[u8; 4]) -> u32 {
    (code[0] as u32) | (code[1] as u32) << 8 | (code[2] as u32) << 16 | (code[3] as u32) << 24
}

impl PixelFormat {
    /// All supported formats in negotiation preference order.
    pub const ALL: [PixelFormat; 4] = [Self::Bgrx, Self::Bgra, Self::Rgbx, Self::Rgba];

    /// Maps a raw SPA video format to a supported pixel format.
    pub fn from_spa(raw: sys::spa_video_format) -> Option<Self> {
        match raw {
            sys::SPA_VIDEO_FORMAT_BGRA => Some(Self::Bgra),
            sys::SPA_VIDEO_FORMAT_BGRx => Some(Self::Bgrx),
            sys::SPA_VIDEO_FORMAT_RGBA => Some(Self::Rgba),
            sys::SPA_VIDEO_FORMAT_RGBx => Some(Self::Rgbx),
            _ => None,
        }
    }

    /// The SPA video format used in PipeWire format negotiation.
    pub fn spa(self) -> VideoFormat {
        match self {
            Self::Bgra => VideoFormat::BGRA,
            Self::Bgrx => VideoFormat::BGRx,
            Self::Rgba => VideoFormat::RGBA,
            Self::Rgbx => VideoFormat::RGBx,
        }
    }

    /// The DRM fourcc describing the same memory layout (little endian).
    pub fn drm_fourcc(self) -> u32 {
        match self {
            Self::Bgra => fourcc(b"AR24"),
            Self::Bgrx => fourcc(b"XR24"),
            Self::Rgba => fourcc(b"AB24"),
            Self::Rgbx => fourcc(b"XB24"),
        }
    }

    /// Whether the red channel is the first byte in memory.
    pub fn red_first(self) -> bool {
        matches!(self, Self::Rgba | Self::Rgbx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pipewire::spa::sys;

    #[test]
    fn maps_to_drm_fourcc() {
        assert_eq!(PixelFormat::Bgra.drm_fourcc(), 0x3432_5241);
        assert_eq!(PixelFormat::Bgrx.drm_fourcc(), 0x3432_5258);
        assert_eq!(PixelFormat::Rgba.drm_fourcc(), 0x3432_4241);
        assert_eq!(PixelFormat::Rgbx.drm_fourcc(), 0x3432_4258);
    }

    #[test]
    fn maps_from_spa() {
        assert_eq!(PixelFormat::from_spa(sys::SPA_VIDEO_FORMAT_BGRx), Some(PixelFormat::Bgrx));
        assert_eq!(PixelFormat::from_spa(sys::SPA_VIDEO_FORMAT_RGBA), Some(PixelFormat::Rgba));
        assert_eq!(PixelFormat::from_spa(sys::SPA_VIDEO_FORMAT_I420), None);
    }

    #[test]
    fn round_trips_through_spa() {
        for format in PixelFormat::ALL {
            assert_eq!(PixelFormat::from_spa(format.spa().as_raw()), Some(format));
        }
    }

    #[test]
    fn reports_channel_order() {
        assert!(PixelFormat::Rgbx.red_first());
        assert!(!PixelFormat::Bgra.red_first());
    }
}
