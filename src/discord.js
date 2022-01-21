const axios = require('axios')
const FormData = require('form-data');
const {createReadStream} = require('fs')
const data = new FormData();

const sendDiscordMessage = async ({file1, file2, file3, content}) =>{
  try {
    console.log('sendDiscordMessage ', {
      file1,
      file2,
      file3,
      content
    })
    data.append('content', content);
    data.append('file1', createReadStream(file1));
    data.append('file2', createReadStream(file2));
    data.append('file3', createReadStream(file3));

    // data.append('file2', createReadStream(file2));

    await axios.post(process.env.DISCORD_WEBHOOK_URL, data, {
      headers:data.getHeaders()
    })
  } catch (e) {
    console.log('sendDiscord() error', e)
  }
}

module.exports = {
  sendDiscordMessage
}
