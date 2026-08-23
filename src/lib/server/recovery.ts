import { randomBytes } from 'node:crypto';

const ADJECTIVES = [
  'amber','autumn','blue','brave','bright','calm','cedar','cherry','cloudy','cobalt','cozy','crisp','dawn','deep','dusty','early',
  'fern','frosty','gentle','golden','green','happy','hazy','honey','indigo','jolly','kind','lilac','little','lucky','maple','mellow',
  'mint','misty','moonlit','mossy','navy','neat','olive','peach','pearly','pine','pink','plum','quiet','rainy','red','river',
  'rosy','round','sage','silver','small','soft','solar','spring','starry','still','sunny','sweet','teal','tiny','violet','warm',
  'winter','wooden','yellow','young','airy','apricot','aqua','breezy','bronze','buttery','clear','cool','coral','cotton','dreamy','dusky',
  'earthy','faded','feather','fresh','glassy','glowy','grassy','gray','ivory','jade','lavender','lemon','light','lucid','marine','milky',
  'muted','ocean','opal','orange','pastel','pebble','powder','purple','rustic','sandy','scarlet','silky','sky','slate','snowy','spruce',
  'stone','sunlit','tan','tender','velvet','verdant','wavy','white','wild','willow','windy','woolly','zesty','quietly','north','south'
] as const;

const NOUNS = [
  'acorn','badger','bamboo','beaver','berry','birch','bird','bison','brook','bunny','cactus','canoe','cedar','cherry','cloud','coral',
  'cricket','daisy','deer','donkey','dove','duck','fern','finch','fox','frog','garden','goose','harbor','hazel','heron','hill',
  'island','ivy','juniper','kite','lake','lantern','leaf','lemon','lily','maple','meadow','mint','moon','moss','moth',
  'mouse','otter','owl','panda','peach','pebble','penguin','pine','plum','poppy','rabbit','rain','reed','river','robin','rose',
  'sage','seal','shell','shore','sparrow','spruce','star','stone','sun','swan','tiger','toad','tulip','valley','violet','willow',
  'apple','apricot','bee','breeze','cabin','candle','clover','comet','crane','dawn','drift','echo','feather','field','flame','forest',
  'glade','grove','honey','iris','jade','koala','lagoon','lark','lotus','mango','marsh','melon','mist','ocean','olive','orchid',
  'pear','petal','pinecone','pond','quail','reef','ridge','sand','seed','sky','snow','sprout','stream','sunset','thistle','wave','wren'
] as const;

export function normalizeRecoveryCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function generateRecoveryCode() {
  const bytes = randomBytes(8);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const index = bytes[i] & 0x7f;
    parts.push(i % 2 === 0 ? ADJECTIVES[index] : NOUNS[index]);
  }
  return parts.join('_');
}
