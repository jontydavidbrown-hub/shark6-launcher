Regenerate the launcher page from the approved design:

    python3 tools/convert_design.py design/sporty-home.dc.html /tmp/template.txt
    cat tools/app-head.js /tmp/template.txt tools/app-tail.js > launcher/src/main/assets/app.js

The converter also rewrites flexbox `gap` into margin classes (the printed CSS goes in
launcher/src/main/assets/index.html) because the car's WebView is too old for flex gap and `inset`.
