# Security and data-flow admission policy

Admission reviews cover CVE posture, network and telemetry behavior, browser storage, server/filesystem access, install scripts, native/WASM code, plugin/remote-code loading, unsafe HTML, serialization, and untrusted-file parsing. Unknown external data flow blocks confidential-document use.

Document engines require isolated workers, input/page/time/memory/CPU limits, temporary-file cleanup, disabled external-resource loading where supported, and explicit handling for malformed PDFs, archive bombs, Office macros/formulas, CSV injection, and resource exhaustion. No candidate may process Partner documents outside SCO-controlled infrastructure without explicit authorization.
