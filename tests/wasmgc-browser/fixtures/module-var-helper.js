if (typeof MessageChannel !== 'undefined') {
 var channel = new MessageChannel();
 console.log(typeof channel.port2);
 channel.port1.close(); channel.port2.close();
}
export const marker=1;
