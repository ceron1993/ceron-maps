# Cerón Maps — APK Android

Este proyecto genera el **APK de Cerón Maps con todos los archivos adentro**: la app funciona
aunque Netlify o cualquier sitio web se caiga o se borre. GitHub lo compila gratis en la nube.

## Una sola vez
1. Crea una cuenta en github.com (si no tienes) y un repositorio nuevo llamado `ceron-maps`
   (**Public** si quieres también la versión web gratis sin insignia en GitHub Pages).
2. En el repositorio: **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta
   (incluida la carpeta `.github`). Abajo toca **Commit changes**.
3. **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `KEYSTORE_PASSWORD`
   - Secret: la contraseña de la llave que te dio Claude (guárdala también en un lugar seguro).
4. **Settings → Pages → Source: GitHub Actions** (opcional, para la versión web sin insignia).
5. Pestaña **Actions → "Compilar APK y publicar" → Run workflow**. Tarda unos 5–8 minutos.

## Descargar e instalar el APK
- En el repositorio, a la derecha: **Releases → Cerón Maps v1.X → CeronMaps-v1.X.apk**.
- Ábrelo desde el celular. Android pedirá permitir "instalar apps de fuentes desconocidas" para Chrome o
  el administrador de archivos: acéptalo solo para esto.
- La primera vez pedirá permiso de **ubicación** y de **cámara**.

## Actualizar la app
Reemplaza los archivos de la carpeta `www` por los de la versión nueva y súbelos (Upload files → Commit).
GitHub compila solo un APK nuevo, y se instala **encima** del anterior sin borrar tus mapas.

## MUY IMPORTANTE: la llave de firma
`android/app/ceron-maps.keystore` + su contraseña son la "firma" de tu app. Si los pierdes, no podrás
instalar actualizaciones encima: tocaría desinstalar (y se borran los mapas guardados) e instalar de nuevo.
Guarda una copia del archivo y de la contraseña fuera de GitHub (por ejemplo en tu Drive).

## Estructura
- `www/` — la app web (la misma de Netlify).
- `android/` — proyecto Android (Capacitor 8). Permisos: GPS, cámara, internet.
- `.github/workflows/build.yml` — compila el APK y publica la web.
