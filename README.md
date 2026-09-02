# Raycast Dictionary History

A Raycast extension that looks up words using the built-in macOS Dictionary and keeps a searchable local history.

## Features

- Look up words without leaving Raycast
- Browse recent words in an interactive list
- Automatically record lookup history
- Track repeated lookups
- Format definitions by part of speech and numbered sense
- Copy definitions, look up words again, or delete history entries
- Store up to 500 entries locally with Raycast `LocalStorage`

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- Node.js and npm (for local installation/development)

## Install locally

```bash
git clone https://github.com/liu-moon/raycast-dictionary-history.git
cd raycast-dictionary-history
npm install
npm run dev
```

Then open Raycast and search for **Dictionary History Search**. Once Raycast has loaded the development extension, the development command can be stopped; run it again whenever code changes need to be loaded.

## Usage

1. Open **Dictionary History Search** in Raycast.
2. Type a word.
3. Select the lookup row and press Enter.
4. Clear the search field to browse recent words.

## Development

```bash
npm install
npm run build
npm run dev
```

## Privacy

Definitions come from the built-in macOS Dictionary. Lookup history is kept locally in Raycast's extension storage and is not uploaded by this extension.

## License

MIT
