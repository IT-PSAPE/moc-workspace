# Pink design revision

The dashboard's existing information hierarchy is retained. The revision gives the workspace and portal a shared, energetic identity: vibrant pink `#f04494`, white and pale pink surfaces, plum text, more generous spacing and clear controls. Semantic progress, danger and warning colors remain distinct.

## Type and assets

Space Grotesk supplies expressive headings and numerals; Manrope supplies body copy, forms and navigation. Both are self-hosted variable fonts. The pairing is a design choice: distinctive display forms with quieter interface text. Research sources: [Space Grotesk's designer](https://fonts.floriankarsten.com/space-grotesk) and [Manrope's upstream project](https://github.com/sharanda/manrope).

Body and form text are 15–16px, supporting labels and helper copy 13–14px. Tiny captions and serif fallback headings are removed. Desktop and phone layouts accommodate larger text rather than shrinking it at narrow widths.

The invented column logo and quote illustration are removed. A simple MOC wordmark is used until an approved brand asset exists. Quotes use typography; standard Lucide icons communicate actions and services. The design does not depend on decorative generated SVGs or remote images.

## Portal journey

One segmented control switches between **Make a request** and **Track & edit**. The main form is the focus, with short contextual guidance. The previous large explainer card and workspace/login links are removed from the public header.

The API issues a cryptographically random tracking code when a request is submitted. The code is the credential for returning requesters; its hash is stored on the API. Internal sequential references remain useful to leaders and are not public access credentials. The code contains no encrypted personal or request data.

Entering a valid code shows status and request details. Pending requests immediately expose an editable form. Approved and rejected requests are read-only. Edit eligibility is enforced by the API, and task notes remain private. The raw tracking code is shown on creation and stays out of URLs, bot messages, logs and leader responses.
