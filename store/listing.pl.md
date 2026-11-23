# Wpis w Chrome Web Store (polski)

Każde pole wklej do Panelu dewelopera (zakładka z polską lokalizacją). Opis szczegółowy to zwykły tekst, bo sklep nie renderuje Markdowna.

## Nazwa (max 75)
Better GHub

## Krótki opis (max 132)
Szybsze recenzje PR-ów na GitHubie: skrzynka w pasku, chipy na liście, skróty i wyszukiwarka plików. Bez serwerów i śledzenia.

## Kategoria
Narzędzia dla programistów (Developer Tools)

## Jedyny cel (single purpose)
Better GHub ma jeden cel: przyspieszać przeglądanie i śledzenie pull requestów na GitHubie. Wszystkie funkcje (dodatkowe informacje i filtry na liście, skrzynka PR-ów z powiadomieniami, skróty klawiszowe i pomoce przy recenzji) działają wyłącznie na pull requestach w serwisie github.com.

## Opis szczegółowy
Better GHub sprawia, że pull requesty na GitHubie szybciej się przegląda, recenzuje i ogarnia. Dodaje do listy brakujące informacje, daje skrzynkę PR-ów w pasku narzędzi i przenosi najczęstsze czynności recenzenta na klawiaturę. Dopasowuje się do motywu GitHuba (jasny, ciemny, przyciemniony, wysoki kontrast) i działa po polsku oraz po angielsku.

LISTA PULL REQUESTÓW
• Rozmiar (od XS do XL) z +dodane / -usunięte linie przy każdym wierszu
• Stan recenzji: "Twoja recenzja", "Prośba o recenzję" i kto został poproszony
• Nierozwiązane wątki z podziałem na autorów, konflikty scalania, ostatnia aktywność
• Chipy "gotowe do scalenia" i "nieaktywne" oraz szybkie filtry jednym kliknięciem (czeka na moją recenzję, gotowe, konflikty, nieaktywne, ukryj wersje robocze)
• Pasek podsumowania: "3 czekają na Twoją recenzję, 2 mają konflikty, 7 nierozwiązanych wątków"
• Sugerowane etykiety na podstawie zmienionych ścieżek (można wyłączyć)

SKRZYNKA W PASKU NARZĘDZI
• Prośby o recenzję, Twoje PR-y i przypisane do Ciebie, z wynikiem checków, decyzją recenzji, konfliktami i rozmiarem zmian
• Licznik nieprzeczytanych, gdy ktoś inny wypchnie zmiany, skomentuje lub zrecenzuje
• Powiadomienia systemowe z godzinami ciszy
• Drzemka i przypinanie dowolnego pull requesta

POMOCE PRZY RECENZJI
• Panel nierozwiązanych wątków oraz skok do następnego i poprzedniego nierozwiązanego wątku
• Postęp recenzji: przejrzane pliki i wątki w jednym miejscu
• Zmiany od ostatniej wizyty
• Wygenerowane pliki (lockfile i podobne) zwijają się automatycznie
• Wyszukiwarka plików: skok do dowolnego zmienionego pliku po nazwie
• Przełączniki białych znaków oraz widoku diffa (podzielony / ujednolicony)
• Ostrzeżenie przed wyjściem z niewysłaną recenzją i szybka ponowna recenzja
• Kopiowanie nazwy gałęzi, linku w Markdownie i polecenia checkout

SKRÓTY KLAWISZOWE
• Każda czynność ma skrót (Alt+C, Alt+J / K, Alt+P, Alt+1..4 i inne); Alt+/ pokazuje ściągawkę
• Wszystkie skróty możesz nagrać i zmienić w ustawieniach; nigdy nie działają podczas pisania

TOKENY I PRYWATNOŚĆ
• Skróty działają bez logowania. Szczegóły na liście i skrzynka wymagają osobistego tokena dostępu GitHuba
• Dodaj osobny token tylko do odczytu (fine-grained) dla każdej organizacji; właściwy zostanie wybrany automatycznie dla każdego repozytorium
• Tokeny są przechowywane wyłącznie w prywatnej bazie IndexedDB rozszerzenia i widzi je tylko jego usługa w tle
• Rozszerzenie łączy się tylko z github.com i api.github.com. Bez analityki, śledzenia i naszych serwerów
• Ustawienia mogą się synchronizować przez Chrome oraz da się je wyeksportować do pliku JSON (tokeny nigdy nie są synchronizowane ani eksportowane)

Better GHub jest open source (MIT): https://github.com/better-ghub/chrome-extension
Projekt niezwiązany z GitHub, Inc.

## Uzasadnienie uprawnień
- storage: Zapisuje ustawienia (język, przełączniki funkcji, skróty, powiadomienia), stan skrzynki (lista Twoich otwartych PR-ów i czas ostatniego wejrzenia), drzemkę i przypięcia oraz krótkotrwały cache odpowiedzi API (chrome.storage.session). Ustawienia może synchronizować Chrome.
- alarms: Planuje cykliczne odświeżanie skrzynki dla licznika i powiadomień oraz okresową weryfikację zapisanych tokenów, bo usługa w tle w Manifest V3 nie działa ciągle.
- notifications: Wyświetla powiadomienia systemowe o prośbach o recenzję i aktywności w Twoich pull requestach, z uwzględnieniem godzin ciszy. Można je wyłączyć w ustawieniach.
- Dostęp do https://github.com/*: Uruchamia skrypt treści, który dodaje chipy, filtry, pasek podsumowania, skróty, ściągawkę, panel wątków i narzędzia do plików na stronach pull requestów i na stronie głównej GitHuba.
- Dostęp do https://api.github.com/*: Pozwala usłudze w tle pobierać dane pull requestów (rozmiar zmian, recenzje, wątki, checki, ostatnią aktywność) przez REST i GraphQL API GitHuba, z tokenem samego użytkownika. To jedyny zewnętrzny adres, z którym rozszerzenie się łączy.
- Kod zdalny: brak. Cały kod jest w paczce; strony rozszerzenia używają script-src 'self'.

## Zakładka Prywatność (deklaracja danych)
Adres polityki prywatności: https://github.com/better-ghub/chrome-extension/blob/main/PRIVACY.md

Typy danych do zaznaczenia:
- Informacje uwierzytelniające: TAK. Osobiste tokeny dostępu GitHuba, przechowywane lokalnie w IndexedDB rozszerzenia i wysyłane wyłącznie do api.github.com.
- Dane umożliwiające identyfikację osoby: TAK (ostrożnie). Login, nazwa wyświetlana i adres awatara z GitHuba są zapisane lokalnie, żeby pokazać, które konto jest połączone. Nic nie opuszcza przeglądarki poza zapytaniami do GitHuba.
- Treść witryn: TAK. Metadane pull requestów są odczytywane z github.com i jego API, by pokazać chipy, skrzynkę i powiadomienia. Przetwarzanie odbywa się lokalnie, bez wysyłania gdziekolwiek indziej.
- Pozostałe kategorie (zdrowie, finanse, lokalizacja, historia przeglądania, aktywność użytkownika, komunikacja osobista): NIE.

Certyfikaty (zaznacz wszystkie trzy):
- Nie sprzedaję ani nie przekazuję danych użytkowników osobom trzecim poza zatwierdzonymi przypadkami użycia.
- Nie używam ani nie przekazuję danych użytkowników w celach niezwiązanych z jedynym celem rozszerzenia.
- Nie używam ani nie przekazuję danych użytkowników do oceny zdolności kredytowej ani w celach pożyczkowych.

W skrócie: tokeny i ustawienia zostają na urządzeniu (ustawienia mogą się synchronizować przez konto Chrome użytkownika); jedyny ruch sieciowy idzie do GitHuba; bez analityki, telemetrii, cookies i reklam.
