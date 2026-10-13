# Interface foundations

The interface uses the public [Untitled UI React repository](https://github.com/untitleduico/react) as a spacing, typography and component reference, adapted to MOC's existing Base UI components and bright pink brand. This is an implementation informed by the public system, not an installation of its React Aria runtime or paid page templates.

## Typography and tokens

The public [theme](https://github.com/untitleduico/react/blob/main/styles/theme.css), [buttons](https://github.com/untitleduico/react/blob/main/components/base/buttons/button.tsx), [inputs](https://github.com/untitleduico/react/blob/main/components/base/input/input.tsx) and [tables](https://github.com/untitleduico/react/blob/main/components/application/table/table.tsx) supplied concrete references. MOC self-hosts Inter for both headings and body copy. The scale uses 14/20 supporting text, 16/24 body and form controls, 18/28 section headings, 24/32 panels and 30/38 desktop page headings. Headings and important controls use weight 600.

Spacing follows 4px increments, with 6px label-to-field spacing, 12–16px within compact groups and 16–24px between sections. Cards use 8–12px radii, neutral borders and restrained shadows. Pink #f04494 remains the main accent; neutral white and gray surfaces support the information hierarchy. Existing Lucide icons follow consistent sizes and stroke styling. Semantic status colors stay distinct.

## Information hierarchy

Repeated demo/live badges, redundant breadcrumbs, rank summaries, decorative headings and infrastructure disclosures were removed. Settings presents the leader, department, rank and approval status once in a table, with add/approve/revoke actions. Readable development-mode behavior remains API-controlled and documented; UI changes do not enable production storage or authentication.

The dashboard retains the user's accepted structure and chairman's quote, in a compact quote row. Department cards adapt to the available width without leaving an isolated fourth card. Boards keep relevant service, ministry and sub-team context and omit exact repetitions.

The public portal has one request/track segmented control, a concise heading and the form. A random bearer code unlocks tracked details and pending edits. Only its hash is persisted; references remain internal identifiers. Approved/rejected details are read-only. Code safety guidance remains at issuance, with repeated explainer panels removed.

On phones, the calendar becomes an agenda for the selected month. The month controls change visible deadlines, with an empty state when needed. Overflowed days expand through a real button. Tables scroll inside their own cards; hidden accessible headers no longer expand the page.
