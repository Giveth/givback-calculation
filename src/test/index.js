const file = require('./traces_report_algree.json')
const {writeFileSync} = require('fs')
const converter = require('json-2-csv');

const traceArray = file.map (  ({
  title,
  recipientAddress,
  slug,
  createdAt,
  campaign,
  recipient
})=> {

  return {
    title,
    slug,
    createdAt,
    campaignTitle: campaign[0].title,
    recipientAddress,
    recipientName: recipient.name || 'Not set'

  }
})
converter.json2csv(traceArray, (err, csv) => {
  if (err) {
    throw err;
  }
  console.log(csv);
  writeFileSync('./trace_report_csv.csv', csv)
});

