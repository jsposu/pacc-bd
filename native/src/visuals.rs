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
        .resize(900, 300, image::imageops::FilterType::Triangle)
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
