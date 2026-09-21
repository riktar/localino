/* eslint-disable @typescript-eslint/no-require-imports */
const { dialog } = require('electron')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.LOCALINO_TEST_PROJECT] })
require('../../out/main/index.js')
