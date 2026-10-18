# akltraffic — 奧克蘭路況鏡頭 · Auckland Traffic Cameras

Personal, free, ad-free website: https://ittonywong.github.io/akltraffic/

- 98 NZTA motorway cameras in Auckland (list grouped by SH1 / SH16 / SH18 / SH20 / SH20A / SH20B, map, search, favourites, nearby).
- Active NZTA closures/incidents, live motorway speeds (congestion colours), Auckland Transport roadworks.
- Six languages (繁中, 简中, English, 日本語, Te reo Māori, 한국어), A− / A / A+ text size, mobile-first.

Data goes through the Cloudflare Worker `akl-traffic-proxy` (https://akl-traffic-proxy.ytonywong.workers.dev), which only answers this site.

## Sources and terms
- Camera images, events and speeds: **NZ Transport Agency Waka Kotahi — Traffic and Travel API**. Images are shown exactly as provided (never cropped, filtered or covered), cached for at most 60 seconds, each with its image time. Only ‘notable’ events verified by NZTA or another official source are listed. No charging, no ads.
- Roadworks: **Auckland Transport Open GIS Data — Roadworks (MyWorksites)**, CC BY 4.0.
- Map: © OpenStreetMap contributors (ODbL), Leaflet (BSD-2-Clause, see vendor/leaflet/LICENSE).
- Not affiliated with NZTA or Auckland Transport.

## Privacy
Favourites, language and text size are stored only in the browser (localStorage). The “nearby” location is used on the device only and is never stored or sent.
