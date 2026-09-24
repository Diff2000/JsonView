# JsonView

En enkel web-app for å vise JSON som et tre der du kan åpne og lukke elementene. Den trenger ikke byggesteg eller avhengigheter.

## Funksjoner

- **Lim inn** JSON som tekst. Den vises automatisk når du limer inn, eller trykk **Vis** / `Ctrl+Enter`.
- **Fil**: slipp en `.json`-fil hvor som helst i vinduet, eller velg den fra disk.
- **URL / curl**: lim inn en URL eller en hel `curl`-kommando. Metode, headere og body leses ut automatisk.
  - Det faste **Token**-feltet erstatter `%token%`, f.eks. `https://…/raw.json?auth=%token%`.
  - Andre plassholdere som `%idTokenFromAuthHere%` eller `{{navn}}` blir egne felt. Verdiene erstattes før henting og lagres bare i den aktuelle nettleserfanen (sessionStorage).
- Dataene ligger alltid som tekst i «Lim inn»-feltet, uansett om de kom fra innliming, fil eller URL. Data fra fil og URL formateres. Teksten lagres i localStorage og vises igjen etter F5.
  - For Firebase Realtime Database legges `.json` til automatisk hvis det mangler.
- Søk i nøkler og verdier. Treff markeres, og treet åpnes frem til dem.
- Åpne alle / lukk alle, pluss visning av rå JSON.
- Klikk på en node for å se stien (f.eks. `/users/abc/name`), og kopier stien eller verdien.
- Store lister rendres i biter på 500 med knappen «Vis flere».

## Kjøre lokalt

```bash
python -m http.server 3000
```

Åpne deretter http://localhost:3000. Du kan også åpne `index.html` direkte i nettleseren.

## Merk

Henting skjer fra nettleseren, så serveren må tillate CORS. Firebase sitt REST-API gjør det.
