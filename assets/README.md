# flinux — grafiska tillgångar

Originalgrafik skapad för **flinux (fake linux)** och devisen **Det glada linuxet**. Alla filer är fristående SVG:er utan externa bilder, bibliotek eller typsnittsfiler. Bilderna fungerar offline.

Öppna `preview.html` via projektets lokala webbserver för att bläddra bland och ladda ner grafiken.

## Identitet

| Fil | Format | Användning |
| --- | --- | --- |
| `mark.svg` | 128 × 128 | Glad pingvin på mintgrön platta. Appikon och startmeny. |
| `favicon.svg` | 64 × 64 | Förenklad ikon för webbläsarfliken. |
| `logo.svg` | 408 × 128 | Ljus logotyp och svensk devis, för mörka ytor. Ordmärket är vektorkurvor; devisen använder systemtypsnitt. |
| `icons.svg` | 24 × 24 per symbol | Ikoner med `currentColor`, rundade linjer och 1,7 enheters linjebredd. |

Använd en symbol med `<svg aria-hidden="true"><use href="assets/icons.svg#terminal"></use></svg>` och ange SVG:ns bredd, höjd och färg i CSS.

Symboler: `terminal`, `files`, `packages`, `settings`, `editor`, `paint`, `games`, `monitor`, `browser`, `image`, `clock`, `help`, `power`, `search`, `volume`, `wifi`, `fullscreen`, `close`, `minimize`, `maximize`, `chevron`, `arrow-right`, `check`, `linux`.

## Bakgrunder

Samtliga bakgrunder är 2560 × 1440 (16:9), skalbara utan kvalitetsförlust. Använd `background-size: cover; background-position: center`.

| Fil | Uttryck |
| --- | --- |
| `wallpapers/glimten.svg` | Djup petrol, liten varm sol och lager av gröna kullar till höger. Stor lugn arbetsyta. Standardbakgrund. |
| `wallpapers/midnatt.svg` | Mörk natthimmel, svagt norrsken och en liten planet med banor. |
| `wallpapers/gryning.svg` | Dämpat varmt gryningsljus och böljande berg i salviagrönt. |
| `wallpapers/terminal.svg` | Mörkgrönt rutnät med diskreta topografiska konturer. |

Grundpalett: petrol `#153d37`, mint `#92d7bc`, ljus lime `#c4eea2`, varm vit `#f4f5df` och aprikos `#efa461`.
