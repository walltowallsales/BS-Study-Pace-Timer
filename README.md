# Bible Study Pace Timer

GitHub/Render web version of the Bible Study Pace Timer.

## Deploy on Render
1. Upload all files in this folder to your GitHub repository.
2. In Render, choose **New +** → **Web Service**.
3. Connect the GitHub repository.
4. Render should detect `render.yaml`. If entering manually, use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Deploy.

The WOL import feature requires internet access on the Render server. The app itself stores lesson settings in the browser's local storage.
