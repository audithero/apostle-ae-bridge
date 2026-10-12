# Open your CommBank account online: a step-by-step guide for people moving to Australia

**Client:** Commonwealth Bank of Australia (CommBank)  
**Logline:** People moving to Australia know what to have ready, and can open a CommBank account and verify their identity on their phone, one step at a time, without getting stuck.

## Audience and objective

**Audience:** New and soon-to-arrive migrants opening an Everyday/Smart Access account in the CommBank app, from overseas or in their first year here. Many speak English as a second language. They watch on a help page or in an app support link, often on a phone, often with the sound off or with captions, and often while doing the steps. Some pause and rewind to copy a step. The supers have to carry every instruction on their own without sound.

**Objective:** More migrants finish digital onboarding on their own. The aim is fewer drop-offs at the passport photo, chip scan and selfie steps, fewer calls and branch visits caused by confusion, and the right people (no ePassport) sent to a branch. It should also meet CommBank's WCAG 2.2 AA marketing accessibility checklist.

**Tone:** calm, clear, welcoming, reassuring, patient

## Key messages

1. Get ready first: an Australian phone number, an Australian address, a valid visa (not a visitor visa) and an ePassport.
2. You can recognise an ePassport by the chip symbol (a small rectangle with a circle and a line) on the cover. No ePassport means you start online and finish in a branch.
3. Photograph your passport in good light with no glare, then scan its chip by holding it to the back of your phone until it vibrates.
4. Take a selfie with nothing covering your face (no hat, no glasses).
5. Employment and tax questions are required by law, and your information is protected.
6. Once you're approved, your account is ready and your debit card is posted to your Australian address. Welcome to Australia.

## Visual system

- **Stage:** corridor · **Ease:** corporate-smooth · **Transitions:** none
- **Layouts:** screen, iconRow, hero, compare, statement, endcard
- **Icons:** Mainly the client's real app screens in the phone. For the readiness checklist, the branch route and the reassurance lines we use native glyphs: phone, home, doc, bank, shield, card, check, cross. There is no pictogram set in this kit, and glyphs match the app's own yellow-circle line icons. The ePassport chip symbol is the one icon the brief insists on and the library has no glyph for it. Until a glyph is added (see libraryGaps) it is shown with screen 27 (an illustrated passport carrying the chip mark) rather than a placeholder.
- **Pacing:** Unhurried. Each app step gets its own scene and the camera trucks sideways along the corridor between them, so the film reads as 'next step' every time. Direct the VO at 130 to 140 wpm with a clear pause after each instruction. Each instruction has its own super on screen for at least 3s, because ESL viewers read more slowly. The film breathes on the three demonstrations (bad scan → good scan, chip read → vibrate → verified, selfie → match) and on the legal 'why we ask' beat. The welcome is the only beat that slows down for warmth.

This is an instructional film for anxious newcomers, not a brand spot. The corridor gives one direction of travel, which works as a progress metaphor without words. lateralTruck transits are short and calm. whipOrbits or an iris on every cut would add motion noise for viewers who are reading in a second language. corporate-smooth keeps entrances gentle and finishes the word reveal quickly so text is static while it is read, as the checklist asks ('keep text static'). The real screens are the hero because viewers will match the film against their own phone. Six layouts used with intent: screen for every in-app step, iconRow for the checklist, hero for the ePassport recognition and the card, compare for online-then-branch, statement for rules and reassurance, and the endcard to close. That keeps the film consistent and makes it easy to rewind to a step.

**Brand:** brands/commbank.json. Use the masterbrand kit: a white stage like the app, black CBA Beacon Sans (Bold for supers, Regular for subs) and yellow as an accent fill only. The film should look like the screens it shows. Accessibility rules for this kit: (1) never set type in yellow and never place yellow type on white. #FAEC20 on white is about 1.2:1 and fails both the 4.5:1 text minimum and the 3:1 icon minimum. Yellow only ever sits behind black type or black line art, where the contrast is about 17:1. (2) Icon tiles are yellow circles with black line art. The black line art carries the 3:1 icon contrast, not the tile edge. (3) Ticks and crosses are always paired with words ('Not accepted' / 'Accepted', 'Do' / 'Don't'), so meaning never depends on colour or shape alone. (4) Supers are sentence case, never all caps, never italic, never underlined, kept to about 12 words or 50 to 70 characters a line, and left-aligned beside the phone. The kit has no logo asset wired in. The Beacon lockup (CBA_CAN_PRM_BCN_STK_WM_BLACK_SRGB_300425.ai) has to be placed on the endcard by hand. The yellow is still undecided: #FAEC20 matches the app screens, #FFCC00 is the classic gold. Our recommendation is #FAEC20 so the stage matches the screens.

## CBA_MIGRANT_ONBOARDING (migrant-digital-onboarding), about 215s

The single support video that walks a new migrant through CommBank's digital onboarding from 'what you need' to 'welcome', with each step tied to the app screen they will see.

| Section | Intent | ~sec | What we see |
|---|---|---|---|
| What this video shows | Tell viewers they can do all of this online, and what they will be able to do by the end. | 8 | Screen '10. Let's open' in the phone: the three-part journey (scan passport, verify ID, open account), with the super 'Open an account and verify your identity online'. |
| Have these ready | Set expectations before anyone starts: the three local essentials plus the visa rule. | 14 | An iconRow that builds item by item as each is spoken: phone 'Australian phone number', home 'Australian address', doc 'Valid Australian visa'. The sub 'Any visa except a visitor visa' arrives with the visa line. Then screen '7. Before you begin' confirms it's the same list the app shows. |
| Do you have an ePassport? | Viewers can recognise the chip symbol on their own passport, which is the step that decides their path. | 20 | Screen '27. Master NFC -- DAY1.5' shows the illustrated passport with the chip mark large in the phone. The super 'Look for this symbol on the front or back cover' and the sub 'It's a chip with your photo and identity details' sit beside it. Once the epassport glyph is built (see gaps) this becomes a hero moment with the symbol drawn full size. |
| No ePassport? Finish in a branch | People without an ePassport still start, and know the extra step is a branch visit. | 14 | Compare: left box 'Start online with your passport', arrow, right box 'Visit a branch to verify', with the bank glyph. One idea, two steps, no ambiguity. |
| Tell us where you are | Viewers know they will choose one of three statuses and which one is theirs. | 22 | Screen '6. ZPO - Migrant redirect' (the three options as they appear in the app), held while the VO reads them. The super restates each option in large type as it is spoken, because the phone text is too small to read at this scale. |
| Photograph your passport | Good light, no glare, photo page in the frame. Show what is rejected and what is accepted. | 22 | Screen '11. ZPO - Scan licence info' (take a photo of your passport). Then screen '13. Scanning Front - iOS' degraded with glare and stamped with a cross, super 'Glare: not accepted'. Then the same screen degraded with blur and a cross. Then screen '14. 8.1 - Scan licence info' (review photo, clear capture) with a tick, super 'Clear and bright: accepted'. |
| Your contact details | Mobile, email and Australian address, and why: we contact you and post your card. | 14 | Screen '15. Extra details (Manual entry) v2.1' scrolling through mobile, email and address. Then a hero card glyph with the super 'We'll post your debit card to this address' as a stand-in for the card arriving in the post (see gaps). |
| Scan your passport chip | The three moves: tap Scan passport chip, wait for Ready to scan, hold the passport to the back of the phone. | 20 | Screen '28. Master NFC' (the numbered how-to). Then screen '29. Master NFC -- DAY1.5' (Ready to scan sheet) with the super 'Hold your passport against the back of your phone'. Each super names one move. A tip moment: 'Nothing happening? Move your phone slowly'. |
| Hold still until it's done | USA and Malaysian passports are opened first. Everyone holds still for 5 to 10 seconds until it vibrates. | 14 | A statement with the doc glyph: 'USA or Malaysian passport? Open it before you scan'. Then screen '30. Master NFC -- DAY1.5' (60%, hold still), screen '31. Master NFC -- DAY1.5' (100% complete) with shake on so the phone buzzes, and screen '32. .' (Your passport has been verified) with a tick. |
| Take a photo of your face | Use the camera and remove anything covering your face: hat, glasses. | 16 | Screen '34.  Selfie instructions- iOS' with the super 'Remove glasses, hats or anything covering your face'. Then a hat-on version of the capture with a cross ('Hat on: not accepted'), which needs an extra asset (see gaps). Then screen '35. 17.1 - Taking selfie' and screen '36. Photo matches ID' with a tick. |
| Work and tax details | Viewers expect two short question sets: their job and where they pay tax. | 10 | Screen '37. 18.1 - Employment status', then screen '43. Tax_ Confirm your tax residency'. Each has one plain super: 'Tell us about your work' and 'Tell us where you pay tax'. |
| Why we ask, and how it's protected | Reassure viewers this is a legal requirement and their information is protected, and give them the exact words to search. | 18 | A hero shield glyph with the super 'Australian banks must collect this by law'. Then a statement with the exact search term on screen, 'Search "Group Privacy Statement" on the CommBank website', held long enough to copy it down. |
| Create a password and PIN | Secure access to the account and the CommBank app. | 10 | Screen '18. Create password - ios', then screen '23. PINCreate' on the opposite side, with the super 'Create a password and a 6-digit PIN'. |
| Approved. Welcome to Australia | Finish on success and warmth: the account is ready and the card is on its way. | 14 | Screen '48. Review your details' (account ready, tick at top) with a tick badge and the super 'Your account is ready to use'. Then screen '47. Card' with the super 'Your debit card is on its way'. Then the endcard: 'Welcome to Australia and welcome to CommBank.' with the Beacon logo placed by hand. |

**VO (client script, verbatim)**, 447 words, about 179s at 150 wpm:

> In this video we will show you how to open an account and verify your identity online.
>
> Before you begin make sure you have the correct documentation:
>
> An Australian phone number
>
> An Australian address
>
> A valid Australian Visa
>
> This would be all Australian visa’s except a visitor visa.
>
> An ePassport
>
> To check if you have an ePassport look for a small rectangle with a circle and line on the front and back cover of the passport. This is a chip that stores your photo and identity details.
>
> If you don’t have an ePassport, you can still start the application online with a standard passport and then visit a branch to complete your identity verification
>
> You will be asked to select one of the options below regarding your status in Australia:
>
> You have lived in Australia for over a year.
>
> You arrived in Australia less than 1 year ago.
>
> You are moving to Australia soon – planning to arrive in the next 14 days
>
> You will then need to scan a photo of your passport.
>
> Ensure you’re in good lighting to avoid glare or reflections.
>
> Hold the photo page of your passport up to the scanning area indicated on the screen and select scan passport.
>
> Please provide your contact details:
>
> Mobile number
>
> Email address
>
> Australian address
>
> We’ll use these details to contact you and send your debit card once it’s ready.
>
> You will be asked to verify your identity.
>
> To complete this step, you will need to:
>
> Tap ‘Scan passport chip’
>
> Wait until you see ‘Ready to scan’
>
> Hold your passport against the back of your phone. If nothing happens, move your phone around slowly until it vibrates
>
> if you are a USA or Malaysian passport holder you will need to open your passport before scanning.
>
> Hold still until the scan finishes. This may take 5-10 seconds
>
> Then you will need to take a photo of your face, using the camera on your device.
>
> Please ensure you have removed glasses, hats or any items that might be covering your face.
>
> You will now need to provide your employment details and information regarding your tax residency.
>
> Australian banks are required by law to collect this information. This information is collected in line with our privacy obligations, to find out more search ‘Group Privacy Statement’ on the CommBank website to see how we protect your information.
>
> You will then need to create a password and PIN so you can securely access your account and the CommBank app.
>
> Once approved, your account will be ready to use, and your debit card will be sent to your nominated Australian address.
>
> Welcome to Australia and welcome to CommBank.

## Assets needed

- The ePassport chip-symbol reference image the script asks us to feature ('imagery such as this'). It did not come through in the Word document. It is used in the epassport-check section and is the reference for the epassport glyph.
- A hat-on (and ideally glasses-on) variant of screen '35. 17.1 - Taking selfie', retouched and approved by CBA and saved into the screens folder under a new name such as '35b. Taking selfie - hat'. It is used in the selfie section as the crossed-out 'don't'.
- Confirmation that we may use the face in screen '35. 17.1 - Taking selfie' in a published video (model release / stock licence), and that it meets CBA's inclusive-representation guidance.
- A Beacon logo lockup exported for video (vector or high-res PNG, plus a dark-mode version) from CBA_CAN_PRM_BCN_STK_WM_BLACK_SRGB_300425.ai, with the colour-use rules. Used on the endcard.
- Final recorded VO (and the music bed, if any) at low background level, per the checklist's audio lines. Timing is estimated at reading pace until the VO arrives.
- Android versions of the key screens, if the film must serve Android users too (all 48 supplied screens are iOS).

## Library gaps

- **The ePassport chip symbol (a rectangle with a circle and a line) drawn as a clean, large icon.**: Recognising the symbol decides which path the viewer takes, and the client asked for it by name. Screen 27 shows it, but small and inside an illustration. _Suggestion:_ Add an `epassport` entry to MOM_GLYPHS: a rounded rectangle outline, a circle and a horizontal bar, about five primitives. It reaches the compile step with no other edit, and the epassport-check section becomes a hero moment.
- **Physical demonstrations: a hand holding the passport up to the camera, the passport touching the back of the phone, a person taking off a hat.**: The visual notes ask for these to show how, not just what. ESL viewers learn faster from seeing the action. _Suggestion:_ There is no character, hand or object animation. Workaround: the real screens carry each step (13 shows the passport in the frame, 29 to 31 the NFC sheet, shake for the vibration). For the chip read, build one custom 'tap' moment: a flat passport shape slides behind the phone mock-up, NFC arcs pulse, then shake. Do it by hand in AE, or as a new `tap` layout if it will recur in other CBA films.
- **The selfie with a hat crossed out, then the clear selfie ticked.**: The script asks for a do/don't pair, and none of the supplied screens shows a covered face. _Suggestion:_ The screen layout already supports badge 'cross'. It needs only a hat-on screenshot in the screens folder (see assetsNeeded). degrade blur/glare cannot fake a hat.
- **A debit card arriving in the post.**: The script asks for it twice (contact details and the close). It explains why the address matters. _Suggestion:_ There is no envelope or mailbox glyph and no move-along-a-path moment. For now, use a hero card glyph plus screen '47. Card'. Adding `mail`/`envelope` glyphs would allow a card → envelope → home iconRow.
- **Captions or subtitles, and a transcript.**: The accessibility checklist requires them, and many viewers watch with the sound off. _Suggestion:_ The library makes no caption track. Once the VO is recorded, align it with vo-align.py and turn words.json into an SRT/VTT plus a plain-text transcript (a small script). Keep the bottom 15% of frame clear of supers for captions, using safeMarginPct or a raised layout baseline.
- **Readable in-app detail (the three status options, the 'Scan passport chip' button, the NFC sheet).**: The phone display is 372x806 inside a 1080p frame, so app text shows at about a third of its real size and is unreadable, especially on a phone screen. _Suggestion:_ There is no zoom or callout on part of a screenshot. For now, supers restate the key words in large type. Worth building a `screen` option for a magnified region with a highlight ring (e.g. `focus: [x,y,w,h]`).
- **The Beacon logo on the endcard.**: Brand sign-off, and the checklist's logo-contrast rule. _Suggestion:_ endcard takes only super/sub/url. Import the logo with APOSTLE.importAssets and place it by hand on a white field after the build.
- **Other formats and languages (9:16 or 1:1 for social or in-app, translated supers).**: The checklist asks us to consider multilingual or Easy English versions, and this audience is a strong case for them. _Suggestion:_ Moment layouts are 1920x1080 only. Translated supers could be done afterwards in the built comps, since supers are live text. Other aspect ratios need the layouts generalised first.

## Risks

- Density: the script is about 435 words across 14 steps, roughly 3.5 minutes at an ESL-friendly pace. That is long for a support video, and viewers will scrub. Each step's super must stand alone so a viewer who jumps in mid-film still knows what to do.
- Script and app disagree in places. The VO says 'select scan passport', but the photo screens say 'Take a photo' and capture automatically. The script puts password and PIN after tax, but the app asks for them before the chip scan (screens 18 to 24). The app's NetCode SMS step (screens 21 and 22) is not in the script at all. Showing screens out of app order, or skipping a step, could confuse the very people the film is for.
- Legal and compliance: 'required by law' and the privacy line are regulated statements. Our supers will be shorter plain-language versions of verbatim VO lines, so CBA legal must approve the on-screen wording as well as the VO.
- Contrast: brand yellow on white fails WCAG for text and icons. Any drift from black on yellow and black on white (yellow labels, yellow outlines on white) fails the checklist the client sent.
- Motion accessibility: word reveals and the NFC shake must settle fast and stay under 3 flashes a second. There are no looping or pulsing elements, because the checklist asks for static text and pausable motion.
- Screen currency: these are October 2026 captures. If the app changes before launch the film is out of date. Screens stay imported files, so a re-capture rebuilds cleanly, but give a cut-off date for UI changes.
- Brand colour is undecided (#FAEC20 vs #FFCC00). Changing it after review repaints CONTROL-linked art but not baked backdrop art, so decide before the first build.
- No VO yet: timing is estimated at reading pace. A slower or faster read will shift every moment until the recorded VO is aligned.

## Open questions

- What format and where will it be hosted: 16:9 1920x1080 for a website help page, in-app, YouTube? Are 9:16 or 1:1 cut-downs needed? Is there a length cap?
- Captions: burnt into the picture, a separate SRT/VTT file, or both? Do you need a transcript and translated versions (which languages)?
- Which yellow should the film carry: #FAEC20 (sampled from the October app screens) or the classic CommBank gold #FFCC00?
- The script asks viewers to 'select scan passport', but the app says 'Take a photo' and captures automatically. Can the VO line be updated to match the app?
- The script places password and PIN after tax residency, but the app asks for them before the chip scan. Should the script be reordered to match the app, or is the film's order deliberate?
- The NetCode SMS step (screens 21 and 22) is not in the script. Should a line be added so viewers aren't surprised by it?
- Can you send the ePassport chip-symbol reference image mentioned in the script? It did not come through in the Word document.
- Can CBA supply or approve a hat-on version of the selfie screen for the 'don't' example? Is the face in screen 35 cleared for publication?
- May on-screen supers be shorter, plain-language versions of the VO (with captions carrying the full words), or must the supers repeat the VO word for word?
- Should the endcard carry a URL or a help route (e.g. a migrant banking page or support number), and which Beacon lockup should be used?
- Should the film name the product (Smart Access, as the screens do) or stay generic ('an account') as the script does?
- Will Android screens be needed, or is the iOS flow acceptable for everyone?
- VO casting: any preference on voice, accent and pace? We recommend a warm, clear read at about 130 to 140 words a minute.
