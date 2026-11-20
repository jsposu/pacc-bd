mod app;
mod visuals;
slint::include_modules!();

fn main() -> Result<(), Box<dyn std::error::Error>> {
    app::run()
}
