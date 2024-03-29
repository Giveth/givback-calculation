const axios = require('axios');
const pinataApiKey = process.env.PINATA_API_KEY;
const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY
export const pinJSONToIPFS = async (params :{
                               jsonBody:any
                             }) :Promise<string> => {
  const url = `https://api.pinata.cloud/pinning/pinJSONToIPFS`;
  const {jsonBody} = params
  try {
    console.log('pinJSONToIPFS has been called')
    const result = await axios
      .post(url, jsonBody, {
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretApiKey
        }
      });
    console.log('pinJSONToIPFS result hash', result.data.IpfsHash )
    return result.data.IpfsHash;
  } catch (e) {
    console.log('pinJSONToIPFS error', e)
    throw e
  }
};

