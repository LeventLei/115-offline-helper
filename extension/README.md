# 115 Offline Helper - Browser Extension

This directory contains the source code for the Chrome Extension version of the 115 Offline Helper.

## Installation

1.  Open Chrome/Edge and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (toggle in the top right).
3.  Click **Load unpacked**.
4.  Select the `extension` folder in this project.

## Development

-   **background.js**: Service worker with a strict 115 API allowlist.
-   **content.js**: Detects links and shows an isolated confirmation UI.
-   **offline-utils.js**: Batch link extraction and filename filtering helpers.
-   **security-utils.js**: API allowlist and authentication-cookie minimization.
-   **manifest.json**: Extension configuration.

## Features

-   Automatic detection of Magnet/ED2K links.
-   Batch paste and deduplication of Magnet/ED2K links.
-   Recursive, confirmed filename ad filtering for a selected non-root directory.
-   "Push to 115" functionality.
-   Settings panel (Theme, Language, Auto-delete/organize).
-   Background monitoring of offline tasks.
