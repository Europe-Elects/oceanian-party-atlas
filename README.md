# Oceanian Party Atlas

An interactive explorer for the parties in the Europe Elects Party & Alliance Database that are associated with Oceania, published by [Oceania Elects](https://oceaniaelects.com/).

- **Map** of Oceania (entities per country/territory; click a mapped jurisdiction to filter).
- **International party federations**, including current and former affiliations.
- **Ideology by region**: each party is a dot, positioned left–right by ideological orientation and grouped into Australia & New Zealand, Melanesia, Micronesia and Polynesia.
- **Table** with every party; click a row to inspect its fields.
- **Ideology legend** with the definitions.

The atlas does not offer a data download and does not display Europe Elects entity IDs.

## Set up the repository

1. In **Settings → Secrets and variables → Actions**, create a repository secret named `PARTY_DB_SHEET_ID` containing the Google Sheet ID for the party database.
2. In **Settings → Pages → Build and deployment**, set the source to **GitHub Actions**.
3. Confirm that the Google Workload Identity Federation provider authorises this repository (`Europe-Elects/oceanian-party-atlas`) and that the `ee-sheets-reader` service account can read the party database.
4. In **Actions**, run **Refresh data & deploy** once using **Run workflow**.

The site will be published at:

https://europe-elects.github.io/oceanian-party-atlas/

The workflow refreshes the data daily at 04:29 UTC and on every push to `main`.

## Data pipeline

The workflow authenticates to Google using the existing Europe Elects Workload Identity Federation setup, exports the tab with GID `0`, filters the sheet to the Oceania ISO-2 codes listed in `.github/workflows/deploy.yml`, and keeps only the columns used by the page.

The workflow currently includes these jurisdictions: Australia, New Zealand, Papua New Guinea, Fiji, Solomon Islands, Vanuatu, Samoa, Tonga, Kiribati, Tuvalu, Nauru, Federated States of Micronesia, Marshall Islands, Palau, American Samoa, Cook Islands, French Polynesia, Guam, New Caledonia, Northern Mariana Islands, Norfolk Island, Pitcairn Islands, Tokelau, Wallis and Futuna, Niue, Christmas Island, Cocos (Keeling) Islands, Heard Island and McDonald Islands, and U.S. Minor Outlying Islands.

Some small territories may not have a separate polygon in the world map at this scale. They are still included in the data, filters and table.

If a jurisdiction is missing from the atlas, check its ISO-2 code in the `OCEANIA` set in the workflow. If it needs its own ideology-chart region, add it to `REGION` and `REGIONS` in `app.js`.

## Files

- `index.html`, `style.css`, `app.js`: the atlas interface.
- `.github/workflows/deploy.yml`: data refresh and GitHub Pages deployment.
- `scripts/sheet_csv.py`: Google Sheets export helper used by the workflow.
