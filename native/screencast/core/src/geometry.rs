//! Frame geometry: crop regions and output sizes.

/// Smallest output edge length, keeps encoders and the packed GPU readback valid.
const MIN_EDGE: u32 = 8;

/// A rectangle in pixel coordinates of a stream buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    /// Rectangle covering a whole buffer of the given size.
    pub fn full(width: u32, height: u32) -> Self {
        Self { x: 0, y: 0, width, height }
    }
}

/// Returns the region of the stream that holds the picture.
///
/// GNOME sends window streams as monitor-sized buffers with a crop region;
/// invalid or missing crops fall back to the whole stream.
pub fn crop_rect(stream_width: u32, stream_height: u32, crop: Option<Rect>) -> Rect {
    match crop {
        Some(c)
            if c.width > 0
                && c.height > 0
                && u64::from(c.x) + u64::from(c.width) <= u64::from(stream_width)
                && u64::from(c.y) + u64::from(c.height) <= u64::from(stream_height) =>
        {
            c
        }
        _ => Rect::full(stream_width, stream_height),
    }
}

/// Fits a source size into a bounding box without upscaling.
///
/// The width is rounded down to a multiple of 8 and the height to a multiple
/// of 2, as required by I420 and the packed GPU readback.
pub fn fit_output_size(src_width: u32, src_height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if src_width == 0 || src_height == 0 {
        return (MIN_EDGE, MIN_EDGE);
    }
    let (sw, sh, mw, mh) = (
        u64::from(src_width),
        u64::from(src_height),
        u64::from(max_width),
        u64::from(max_height),
    );
    let (width, height) = if sw <= mw && sh <= mh {
        (sw, sh)
    } else if mw * sh <= mh * sw {
        (mw, sh * mw / sw)
    } else {
        (sw * mh / sh, mh)
    };
    let width = (width - width % 8).max(u64::from(MIN_EDGE));
    let height = (height - height % 2).max(u64::from(MIN_EDGE));
    (width as u32, height as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_larger_source_into_box() {
        assert_eq!(fit_output_size(2560, 1440, 1920, 1080), (1920, 1080));
    }

    #[test]
    fn never_upscales() {
        assert_eq!(fit_output_size(1280, 720, 1920, 1080), (1280, 720));
    }

    #[test]
    fn rounds_width_to_eight_and_height_to_two() {
        assert_eq!(fit_output_size(1003, 701, 1920, 1080), (1000, 700));
    }

    #[test]
    fn ultrawide_source_is_limited_by_width() {
        assert_eq!(fit_output_size(3440, 1440, 1920, 1080), (1920, 802));
    }

    #[test]
    fn tiny_source_is_at_least_eight_by_eight() {
        assert_eq!(fit_output_size(7, 7, 1920, 1080), (8, 8));
    }

    #[test]
    fn valid_crop_is_kept() {
        let crop = Rect { x: 100, y: 50, width: 800, height: 600 };
        assert_eq!(crop_rect(2560, 1440, Some(crop)), crop);
    }

    #[test]
    fn empty_crop_uses_full_stream() {
        let crop = Rect { x: 0, y: 0, width: 0, height: 0 };
        assert_eq!(crop_rect(2560, 1440, Some(crop)), Rect { x: 0, y: 0, width: 2560, height: 1440 });
    }

    #[test]
    fn crop_outside_stream_uses_full_stream() {
        let crop = Rect { x: 2000, y: 0, width: 800, height: 600 };
        assert_eq!(crop_rect(2560, 1440, Some(crop)), Rect { x: 0, y: 0, width: 2560, height: 1440 });
    }
}
