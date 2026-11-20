use slint::{Rgba8Pixel, SharedPixelBuffer};

pub struct Cover {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub glow: Vec<u8>,
}

pub fn decode(bytes: Vec<u8>) -> Result<Cover, String> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 * 1024 * 1024);
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    reader.limits(limits);
    let image = reader.decode().map_err(|e| e.to_string())?;
    let cover = image
        .resize(600, 210, image::imageops::FilterType::Triangle)
        .to_rgba8();
    let glow = image
        .resize_exact(200, 60, image::imageops::FilterType::Triangle)
        .blur(14.0)
        .to_rgba8();
    Ok(Cover {
        width: cover.width(),
        height: cover.height(),
        pixels: cover.into_raw(),
        glow: glow.into_raw(),
    })
}

// Same official osu! spectrum as src/difficultyColours.ts (ppy/osu, MIT).
// Interpolation is in linear light, not directly between sRGB channel values.
pub fn star_colour(value: f32) -> slint::Color {
    const STOPS: [(f32, [u8; 3]); 13] = [
        (0.0, [66, 144, 251]),
        (0.1, [66, 144, 251]),
        (1.25, [79, 192, 255]),
        (2.0, [79, 255, 213]),
        (2.5, [124, 255, 79]),
        (3.3, [246, 240, 92]),
        (4.2, [255, 128, 104]),
        (4.9, [255, 78, 111]),
        (5.8, [198, 69, 184]),
        (6.7, [101, 99, 222]),
        (7.7, [24, 21, 142]),
        (9.0, [0, 0, 0]),
        (10.0, [0, 0, 0]),
    ];
    if !value.is_finite() || value < 0.0 {
        return slint::Color::from_rgb_u8(167, 173, 183);
    }
    let mut rgb = [0; 3];
    for pair in STOPS.windows(2) {
        let [(a, ca), (b, cb)] = pair else {
            unreachable!()
        };
        if value > *b {
            continue;
        }
        let t = ((value - a) / (b - a)).clamp(0.0, 1.0);
        for index in 0..3 {
            let linear = |v: u8| {
                let v = v as f32 / 255.0;
                if v <= 0.04045 {
                    v / 12.92
                } else {
                    ((v + 0.055) / 1.055).powf(2.4)
                }
            };
            let v = linear(ca[index]) * (1.0 - t) + linear(cb[index]) * t;
            let v = if v <= 0.0031308 {
                12.92 * v
            } else {
                1.055 * v.powf(1.0 / 2.4) - 0.055
            };
            rgb[index] = (v * 255.0).round() as u8;
        }
        return slint::Color::from_rgb_u8(rgb[0], rgb[1], rgb[2]);
    }
    slint::Color::from_rgb_u8(0, 0, 0)
}

pub fn star_handle(value: f32) -> slint::Color {
    if value >= 8.0 {
        slint::Color::from_rgb_u8(68, 68, 68)
    } else {
        star_colour(value)
    }
}

pub fn star_ink(value: f32) -> slint::Color {
    if value >= 6.5 {
        slint::Color::from_rgb_u8(255, 229, 135)
    } else {
        slint::Color::from_rgb_u8(18, 27, 36)
    }
}

pub fn bpm_colour(value: f32) -> slint::Color {
    let t = ((value - 80.0) / 240.0).clamp(0.0, 1.0);
    let blue = [88.0, 166.0, 255.0];
    let red = [239.0, 101.0, 117.0];
    let channel = |i: usize| (blue[i] + (red[i] - blue[i]) * t).round() as u8;
    slint::Color::from_rgb_u8(channel(0), channel(1), channel(2))
}

pub fn images(cover: Cover) -> (slint::Image, slint::Image) {
    (
        slint::Image::from_rgba8(SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
            &cover.pixels,
            cover.width,
            cover.height,
        )),
        slint::Image::from_rgba8(SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
            &cover.glow,
            200,
            60,
        )),
    )
}

pub fn placeholder(index: usize) -> slint::Image {
    let mut buffer = SharedPixelBuffer::<Rgba8Pixel>::new(600, 180);
    let base = [[124u8, 95, 70], [56, 115, 151], [74, 124, 113]][index % 3];
    for (i, pixel) in buffer.make_mut_slice().iter_mut().enumerate() {
        let x = (i % 600) as f32 / 600.0;
        let y = (i / 600) as f32 / 180.0;
        let m = 0.35 + (x * 9.0 + y * 4.0).sin().abs() * 0.65;
        *pixel = Rgba8Pixel::new(
            (base[0] as f32 * m) as u8,
            (base[1] as f32 * m) as u8,
            (base[2] as f32 * m) as u8,
            255,
        );
    }
    slint::Image::from_rgba8(buffer)
}

pub fn triangles() -> slint::Image {
    let mut buffer = SharedPixelBuffer::<Rgba8Pixel>::new(1680, 120);
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
        | 1;
    let mut random = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut cells: Vec<usize> = (0..48).collect();
    for i in (1..48).rev() {
        cells.swap(i, random() as usize % (i + 1));
    }
    for cell in cells.into_iter().take(24) {
        let flipped = random() % 2 == 0;
        for y in 0..60 {
            let t = if flipped { 59 - y } else { y };
            let edge = t * 35 / 60;
            for x in edge..70 - edge {
                let row = cell / 24 * 60 + y;
                buffer.make_mut_slice()[row * 1680 + cell % 24 * 70 + x] =
                    Rgba8Pixel::new(142, 182, 204, (150.0 * (1.0 - row as f32 / 120.0)) as u8);
            }
        }
    }
    slint::Image::from_rgba8(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spectrum_and_tempo_endpoints_preserve_their_colours() {
        assert_eq!(star_colour(0.0), slint::Color::from_rgb_u8(66, 144, 251));
        assert_eq!(star_colour(5.8), slint::Color::from_rgb_u8(198, 69, 184));
        assert_eq!(star_colour(10.0), slint::Color::from_rgb_u8(0, 0, 0));
        assert_ne!(star_handle(10.0), star_colour(10.0));
        assert_eq!(bpm_colour(0.0), bpm_colour(80.0));
        assert_eq!(bpm_colour(320.0), bpm_colour(600.0));
        assert_ne!(bpm_colour(80.0), bpm_colour(320.0));
    }
}
