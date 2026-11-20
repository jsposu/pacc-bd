pub mod desktop;
pub mod download;
pub mod model;
pub mod network;

pub fn columns(width: f32) -> usize {
    if width >= 1180.0 {
        3
    } else if width >= 760.0 {
        2
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn responsive_breakpoints() {
        for (width, columns) in [
            (1440.0, 3),
            (1180.0, 3),
            (1000.0, 2),
            (760.0, 2),
            (390.0, 1),
        ] {
            assert_eq!(super::columns(width), columns);
        }
    }
}
