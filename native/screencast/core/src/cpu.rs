//! CPU conversion of shared-memory frames to I420 (fallback path).

use fast_image_resize::images::{Image, ImageRef};
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use yuvutils_rs::{
    bgra_to_yuv420, rgba_to_yuv420, BufferStoreMut, YuvConversionMode, YuvPlanarImageMut, YuvRange,
    YuvStandardMatrix,
};

use crate::formats::PixelFormat;
use crate::geometry::Rect;

const BYTES_PER_PIXEL: usize = 4;

/// Converts the `crop` region of a packed 32-bit RGB buffer to I420.
///
/// The region is scaled to `out_width` x `out_height` (bilinear) and written as
/// BT.601 limited range Y, U and V planes into `out`, which is resized to fit.
pub fn convert_to_i420(
    src: &[u8],
    stride: usize,
    format: PixelFormat,
    crop: Rect,
    out_width: u32,
    out_height: u32,
    out: &mut Vec<u8>,
) -> Result<(), String> {
    validate(src, stride, crop, out_width, out_height)?;
    if crop.width == out_width && crop.height == out_height {
        let start = crop.y as usize * stride + crop.x as usize * BYTES_PER_PIXEL;
        return write_i420(&src[start..], stride, format, out_width, out_height, out);
    }
    let scaled = scale(src, stride, crop, out_width, out_height)?;
    write_i420(&scaled, out_width as usize * BYTES_PER_PIXEL, format, out_width, out_height, out)
}

/// Checks that the buffer covers the crop and the output size is usable for I420.
fn validate(src: &[u8], stride: usize, crop: Rect, out_width: u32, out_height: u32) -> Result<(), String> {
    if out_width == 0 || out_height == 0 || out_width % 2 != 0 || out_height % 2 != 0 {
        return Err(format!("invalid output size {out_width}x{out_height}"));
    }
    if stride % BYTES_PER_PIXEL != 0 || stride < (crop.x + crop.width) as usize * BYTES_PER_PIXEL {
        return Err(format!("stride {stride} does not cover crop {crop:?}"));
    }
    let needed = (crop.y + crop.height) as usize * stride;
    if crop.width == 0 || crop.height == 0 || src.len() < needed {
        return Err(format!("buffer of {} bytes does not cover crop {crop:?}", src.len()));
    }
    Ok(())
}

/// Scales the crop region into a tightly packed buffer of the output size.
fn scale(src: &[u8], stride: usize, crop: Rect, out_width: u32, out_height: u32) -> Result<Vec<u8>, String> {
    let rows = crop.y + crop.height;
    let source = ImageRef::new((stride / BYTES_PER_PIXEL) as u32, rows, &src[..rows as usize * stride], PixelType::U8x4)
        .map_err(|e| e.to_string())?;
    let mut target = Image::new(out_width, out_height, PixelType::U8x4);
    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))
        .crop(f64::from(crop.x), f64::from(crop.y), f64::from(crop.width), f64::from(crop.height));
    Resizer::new().resize(&source, &mut target, &options).map_err(|e| e.to_string())?;
    Ok(target.into_vec())
}

/// Converts a packed 32-bit RGB image to BT.601 limited range I420.
fn write_i420(rgb: &[u8], stride: usize, format: PixelFormat, width: u32, height: u32, out: &mut Vec<u8>) -> Result<(), String> {
    let luma = width as usize * height as usize;
    out.resize(luma + luma / 2, 0);
    let (y_plane, chroma) = out.split_at_mut(luma);
    let (u_plane, v_plane) = chroma.split_at_mut(luma / 4);
    let mut image = YuvPlanarImageMut {
        y_plane: BufferStoreMut::Borrowed(y_plane),
        y_stride: width,
        u_plane: BufferStoreMut::Borrowed(u_plane),
        u_stride: width / 2,
        v_plane: BufferStoreMut::Borrowed(v_plane),
        v_stride: width / 2,
        width,
        height,
    };
    let convert = if format.red_first() { rgba_to_yuv420 } else { bgra_to_yuv420 };
    convert(&mut image, rgb, stride as u32, YuvRange::Limited, YuvStandardMatrix::Bt601, YuvConversionMode::Balanced)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::PixelFormat;
    use crate::geometry::Rect;

    const BGRX_RED: [u8; 4] = [0, 0, 255, 255];
    const RGBX_RED: [u8; 4] = [255, 0, 0, 255];

    fn solid(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
        pixel.repeat((width * height) as usize)
    }

    fn convert(src: &[u8], width: u32, height: u32, format: PixelFormat) -> Vec<u8> {
        let mut out = Vec::new();
        convert_to_i420(src, width as usize * 4, format, Rect::full(width, height), width, height, &mut out).unwrap();
        out
    }

    fn assert_planes(out: &[u8], width: u32, height: u32, y: u8, u: u8, v: u8, tolerance: u8) {
        let luma = (width * height) as usize;
        let chroma = luma / 4;
        assert_eq!(out.len(), luma + 2 * chroma);
        let near = |value: u8, expected: u8| value.abs_diff(expected) <= tolerance;
        assert!(out[..luma].iter().all(|&s| near(s, y)), "Y plane {:?} != {}", &out[..4], y);
        assert!(out[luma..luma + chroma].iter().all(|&s| near(s, u)), "U plane {:?} != {}", &out[luma..luma + 4], u);
        assert!(out[luma + chroma..].iter().all(|&s| near(s, v)), "V plane {:?} != {}", &out[luma + chroma..luma + chroma + 4], v);
    }

    #[test]
    fn white_becomes_limited_range_white() {
        for format in [PixelFormat::Bgrx, PixelFormat::Rgbx] {
            let out = convert(&solid(64, 32, [255; 4]), 64, 32, format);
            assert_planes(&out, 64, 32, 235, 128, 128, 0);
        }
    }

    #[test]
    fn black_becomes_limited_range_black() {
        for format in [PixelFormat::Bgrx, PixelFormat::Rgbx] {
            let out = convert(&solid(64, 32, [0, 0, 0, 255]), 64, 32, format);
            assert_planes(&out, 64, 32, 16, 128, 128, 0);
        }
    }

    #[test]
    fn red_uses_bt601_coefficients() {
        let out = convert(&solid(64, 32, BGRX_RED), 64, 32, PixelFormat::Bgrx);
        assert_planes(&out, 64, 32, 82, 90, 240, 1);
        let out = convert(&solid(64, 32, RGBX_RED), 64, 32, PixelFormat::Rgbx);
        assert_planes(&out, 64, 32, 82, 90, 240, 1);
    }

    #[test]
    fn crop_selects_only_the_region() {
        let mut src = solid(64, 32, [0, 0, 0, 255]);
        for y in 8..24 {
            for x in 32..48 {
                let offset = (y * 64 + x) * 4;
                src[offset..offset + 4].copy_from_slice(&[255; 4]);
            }
        }
        let mut out = Vec::new();
        let crop = Rect { x: 32, y: 8, width: 16, height: 16 };
        convert_to_i420(&src, 64 * 4, PixelFormat::Bgrx, crop, 16, 16, &mut out).unwrap();
        assert_planes(&out, 16, 16, 235, 128, 128, 0);
    }

    #[test]
    fn scales_down_to_requested_size() {
        let mut out = Vec::new();
        convert_to_i420(&solid(128, 64, [255; 4]), 128 * 4, PixelFormat::Bgrx, Rect::full(128, 64), 64, 32, &mut out).unwrap();
        assert_planes(&out, 64, 32, 235, 128, 128, 0);
    }

    #[test]
    fn output_size_can_change_between_calls() {
        let mut out = Vec::new();
        convert_to_i420(&solid(256, 128, [255; 4]), 256 * 4, PixelFormat::Bgrx, Rect::full(256, 128), 64, 32, &mut out).unwrap();
        assert_eq!(out.len(), 64 * 32 * 3 / 2);
        convert_to_i420(&solid(256, 128, [255; 4]), 256 * 4, PixelFormat::Bgrx, Rect::full(256, 128), 128, 64, &mut out).unwrap();
        assert_eq!(out.len(), 128 * 64 * 3 / 2);
    }

    #[test]
    fn rejects_buffer_smaller_than_crop() {
        let mut out = Vec::new();
        let result = convert_to_i420(&solid(16, 16, [0; 4]), 16 * 4, PixelFormat::Bgrx, Rect::full(32, 32), 16, 16, &mut out);
        assert!(result.is_err());
    }
}
