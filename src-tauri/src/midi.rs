use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use midir::{
    MidiInput, MidiInputConnection, MidiInputPort, MidiOutput, MidiOutputConnection, MidiOutputPort,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const DAW_KEYWORD: &str = "daw";
const FALLBACK_KEYWORD: &str = "launchkey";
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

// Note On, channel 16, note 0x0C: tells the Launchkey to hand control of the pads
// and knobs to the host (DAW mode), which also unlocks pad LED control.
const DAW_MODE_ON: [u8; 3] = [0x9F, 0x0C, 0x7F];
const DAW_MODE_OFF: [u8; 3] = [0x9F, 0x0C, 0x00];

#[derive(Default)]
pub struct MidiState {
    device: Mutex<Option<String>>,
    output: Mutex<Option<MidiOutputConnection>>,
}

#[derive(Clone, Serialize)]
struct ConnectedPayload {
    name: String,
}

#[derive(Clone, Serialize)]
struct NoteOnPayload {
    note: u8,
    velocity: u8,
}

#[derive(Clone, Serialize)]
struct ControlChangePayload {
    controller: u8,
    value: u8,
}

#[tauri::command]
pub fn midi_status(state: State<MidiState>) -> Option<String> {
    state.device.lock().unwrap().clone()
}

#[tauri::command]
pub fn midi_send(state: State<MidiState>, message: Vec<u8>) {
    if let Some(conn) = state.output.lock().unwrap().as_mut() {
        let _ = conn.send(&message);
    }
}

fn find_input(midi: &MidiInput) -> Option<(MidiInputPort, String)> {
    let mut fallback = None;
    for port in midi.ports() {
        if let Ok(name) = midi.port_name(&port) {
            let lower = name.to_lowercase();
            if lower.contains(DAW_KEYWORD) {
                return Some((port, name));
            }
            if lower.contains(FALLBACK_KEYWORD) && fallback.is_none() {
                fallback = Some((port, name));
            }
        }
    }
    fallback
}

fn find_output(midi: &MidiOutput) -> Option<MidiOutputPort> {
    let mut fallback = None;
    for port in midi.ports() {
        if let Ok(name) = midi.port_name(&port) {
            let lower = name.to_lowercase();
            if lower.contains(DAW_KEYWORD) {
                return Some(port);
            }
            if lower.contains(FALLBACK_KEYWORD) && fallback.is_none() {
                fallback = Some(port);
            }
        }
    }
    fallback
}

fn handle_message(app: &AppHandle, message: &[u8]) {
    if message.len() < 3 {
        return;
    }
    let status = message[0] & 0xF0;
    let data1 = message[1];
    let data2 = message[2];
    match status {
        0x90 if data2 > 0 => {
            let _ = app.emit(
                "midi:noteon",
                NoteOnPayload {
                    note: data1,
                    velocity: data2,
                },
            );
        }
        0xB0 => {
            let _ = app.emit(
                "midi:controlchange",
                ControlChangePayload {
                    controller: data1,
                    value: data2,
                },
            );
        }
        _ => {}
    }
}

fn try_connect(app: &AppHandle) -> Option<(MidiInputConnection<()>, String)> {
    let midi_in = MidiInput::new("performer-midi-in").ok()?;
    let (in_port, name) = find_input(&midi_in)?;

    let midi_out = MidiOutput::new("performer-midi-out").ok()?;
    let out_port = find_output(&midi_out)?;
    let mut out_conn = midi_out.connect(&out_port, "performer-midi-out").ok()?;
    let _ = out_conn.send(&DAW_MODE_ON);

    let cb_app = app.clone();
    let in_conn = midi_in
        .connect(
            &in_port,
            "performer-midi-in",
            move |_timestamp, message, _| handle_message(&cb_app, message),
            (),
        )
        .ok()?;

    let state = app.state::<MidiState>();
    *state.device.lock().unwrap() = Some(name.clone());
    *state.output.lock().unwrap() = Some(out_conn);
    Some((in_conn, name))
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut input_conn: Option<MidiInputConnection<()>> = None;

        loop {
            if input_conn.is_none() {
                if let Some((conn, name)) = try_connect(&app) {
                    input_conn = Some(conn);
                    let _ = app.emit("midi:connected", ConnectedPayload { name });
                }
            } else {
                let still_present = MidiInput::new("performer-midi-watch")
                    .ok()
                    .and_then(|m| find_input(&m))
                    .is_some();
                if !still_present {
                    input_conn = None;
                    let state = app.state::<MidiState>();
                    if let Some(conn) = state.output.lock().unwrap().as_mut() {
                        let _ = conn.send(&DAW_MODE_OFF);
                    }
                    *state.device.lock().unwrap() = None;
                    *state.output.lock().unwrap() = None;
                    let _ = app.emit("midi:disconnected", ());
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}
