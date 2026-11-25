// Sin consola en release (en debug se deja para ver los logs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easy_cut_lib::run()
}
