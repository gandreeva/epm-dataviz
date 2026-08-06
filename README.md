
    # EPM Chart Builder Prototype

    A clickable frontend-only prototype built with real mock JSON files

    ## Getting Started (Node.js 20)

    ```bash
    source /root/.nvm/nvm.sh
    nvm use 20
    npm install
    npm run dev

  Production build:

    npm run build

  The application operates entirely without a backend. Actions such as Save, Discard, and changing aggregation levels simulate a client-side
  config flow. The full scope and technical decisions are detailed in docs/DEVELOPMENT_SPEC.md.

  ## Functional Identifiers

  Key components feature a stable data-ui-id attribute. The UI IDs button in the top bar activates a visual inspector mode. Component
  requirements can reference these using the UI[topbar.action.save] notation. The complete registry can be found in the specification
  document.