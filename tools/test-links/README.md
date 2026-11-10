# Link finder tests

Checks the photo/PDF viewer's "find links and QR codes" feature (`TD.linkFinder` in
editor/app.js): every link is found, nothing extra is added, and each button gets the right name.

    cd tools/test-links
    npm install                      # pdf.js, jsQR, Tesseract (the same versions the editor loads)
    pip install qrcode reportlab pillow
    python3 make.py && python3 make2.py   # writes fx/, fx2/ and expected*.json
    (cd ../.. && python3 -m http.server 8765 &)
    node run.js                       # bulletins, flyers, photos, scans
    node run.js fx2 expected2.json    # columns, dark flyer, real Bethany flyers (no links)

Each line prints `ok`, `NAME` (found but named wrong), `MISS` or `EXTRA`. In expected*.json a
label can be a list of names that are all fine. The browser's CDN requests are answered from
node_modules, so it runs without internet (except make2.py fetching the Bethany flyers).
