import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SWITCHBOT_API_TOKEN,
  SWITCHBOT_API_SECRET,
  SWITCHBOT_BOT_TOILET_FAN_DEVICE_ID,
} = process.env;

async function main() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !SWITCHBOT_API_TOKEN ||
    !SWITCHBOT_API_SECRET ||
    !SWITCHBOT_BOT_TOILET_FAN_DEVICE_ID
  ) {
    throw new Error('Required environment variables are missing.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const nowUtc = new Date().toISOString();

  const { data: records, error: selectError } = await supabase
    .from('device_action_queue')
    .select('*')
    .eq('label', 'switch_toilet_fan')
    .lte('action_at', nowUtc)
    .eq('is_processed', false)
    .limit(1);

  if (selectError) {
    throw new Error(`Failed to fetch data from Supabase: ${selectError.message}`);
  }else if (!records || records.length === 0) {
    return;
  }

  const recordToProcess = records[0];
  const { data: updatedData, error: updateError } = await supabase
    .from('device_action_queue')
    .update({ is_processed: true })
    .eq('id', recordToProcess.id)
    .eq('action_at', recordToProcess.action_at)
    .select();

  if (updateError) {
    throw new Error(`Failed to update record: ${updateError.message}`);
  }else if (!updatedData?.length) {
    return;
  }

  const t = Date.now().toString();
  const nonce = uuidv4();
  const data = SWITCHBOT_API_TOKEN + t + nonce;
  const signTerm = crypto.createHmac('sha256', SWITCHBOT_API_SECRET)
    .update(Buffer.from(data, 'utf-8'))
    .digest();
  const sign = signTerm.toString('base64');

  const switchbotApiUrl = `https://api.switch-bot.com/v1.1/devices/${SWITCHBOT_BOT_TOILET_FAN_DEVICE_ID}/commands`;

  const switchbotResponse = await fetch(switchbotApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': SWITCHBOT_API_TOKEN,
      'Content-Type': 'application/json; charset=utf8',
      't': t,
      'nonce': nonce,
      'sign': sign,
    },
    body: JSON.stringify({
      command: 'press',
      parameter: 'default',
      commandType: 'command',
    }),
  });

  const responseJson = await switchbotResponse.json();

  if (!switchbotResponse.ok || responseJson.statusCode !== 100) {
    const errorMessage = responseJson.message || 'Unknown error';
    throw new Error(`SwitchBot API request failed: ${switchbotResponse.status} - ${errorMessage}`);
  }


}

main().catch((error) => {
  console.error('Unexpected error occurred:', error.message);
  process.exit(1);
}); 