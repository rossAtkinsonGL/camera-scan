# mock-backend

**This folder stands in for the server.** Everything outside it is the capture library that runs in the
browser. Everything in it is work the real system would do on a server.

| Here (mock back end) | In production |
| --- | --- |
| `omr.ts`: finds which bubbles are filled in and turns them into question and answer data | A server endpoint that receives the image and returns the same data |

## The seam

The library calls `readAnswers(frame, corners, rotation, qrText)` from `src/quality/browser.ts`, only when
`readAnswers` is on (default for answer sheets). To go to a real back end, replace that one call with
an upload of the captured image and use the response as the `reading`. Nothing else in the library
needs to change, because it already treats `reading` as optional.

## The output contract

`toScorableResponse(reading)` gives the plain data a scorer needs:

```json
{
  "assessment": "MATH-U3",
  "form": "A",
  "student": "S001",
  "responses": [
    { "question": 1, "answer": "B" },
    { "question": 2, "answer": null }
  ]
}
```

`answer` is `null` for a blank, a double mark or an unclear mark. The fuller `SheetReading` also carries each
question's `status`, `confidence` and every `marked` option, so a person can review anything doubtful.
The real contract will come from the host application; this is a placeholder shaped like it.

## Why it can sit in the browser for now

Reading bubbles needs the sheet outline, the QR code and a perspective correction, all of which the capture
side already computes. Running it client-side lets the PoC show the whole path end to end without a server.
It's deliberately self-contained (it imports only image helpers and the sheet layout) so it can move.
