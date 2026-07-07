# 외부 링크로 배포하기

현재 앱은 정적 파일만으로 동작하므로 GitHub Pages, Netlify, Vercel 등에 바로 올릴 수 있습니다.

GitHub Pages에서는 `kokring-inventory` 폴더 안의 파일들을 저장소 최상단에 업로드하세요.

```text
index.html
styles.css
app.js
README.md
.nojekyll
```

GitHub 저장소에서 `Settings` > `Pages` > `Deploy from a branch`를 선택하고, branch는 `main`, 폴더는 `/root`로 설정하면 됩니다.
