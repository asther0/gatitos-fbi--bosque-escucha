// Bosque Escucha BESC v1 receiver: bounded TCP -> USB relay. No inference.
#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <esp_system.h>

constexpr uint32_t SERIAL_BAUD=921600;
constexpr uint16_t TCP_PORT=3333, HEADER_SIZE=52, MAX_PAYLOAD=1024, MAX_FRAME=1080;
constexpr uint8_t AUDIO=1, JPEG=2, FRAME_STATUS=3, CONFIG=16, ACK=128;
Preferences settings;
WiFiServer server(TCP_PORT);
WiFiClient client;
struct Parser { uint8_t bytes[MAX_FRAME]; size_t length=0, expected=0; } usb, network;
uint8_t pending[MAX_FRAME]; size_t pendingLength=0;
uint32_t pendingSequence=0, sentAt=0, lastStatus=0, statusSequence=0;
uint32_t crc32(const uint8_t* data,size_t length){uint32_t crc=0xffffffff;while(length--){crc^=*data++;for(int i=0;i<8;i++)crc=(crc>>1)^((crc&1)?0xedb88320:0);}return ~crc;}
uint32_t read32(const uint8_t*p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
void put32(uint8_t*p,uint32_t n){for(int i=0;i<4;i++)p[i]=(n>>(i*8))&255;}
// Only accepts complete bounded frames with valid CRC. Malformed input never allocates memory.
bool feed(Parser& p,uint8_t value){
 if(p.length<4){const char* magic="BESC";if(value!=magic[p.length]){p.length=value=='B'?1:0;if(p.length)p.bytes[0]='B';return false;}}
 p.bytes[p.length++]=value;
 if(p.length==HEADER_SIZE){uint32_t payload=read32(p.bytes+24);if(p.bytes[4]!=1||p.bytes[7]!=HEADER_SIZE||payload>MAX_PAYLOAD){p.length=0;p.expected=0;return false;}p.expected=HEADER_SIZE+payload+4;}
 if(p.expected&&p.length==p.expected){bool good=crc32(p.bytes,p.length-4)==read32(p.bytes+p.length-4);p.length=0;p.expected=0;return good;}return false;
}
void emitStatus(const char* state){uint8_t frame[MAX_FRAME]={};memcpy(frame,"BESC",4);frame[4]=1;frame[5]=FRAME_STATUS;frame[7]=HEADER_SIZE;put32(frame+8,++statusSequence);memcpy(frame+36,"RECEIVER",8);String ip=WiFi.localIP().toString();String body=String("{\"role\":\"receiver\",\"state\":\"")+state+"\",\"wifi_connected\":"+(WiFi.status()==WL_CONNECTED?"true":"false")+",\"ip\":\""+ip+"\",\"tcp_port\":3333,\"baud\":921600}";put32(frame+24,body.length());memcpy(frame+HEADER_SIZE,body.c_str(),body.length());put32(frame+HEADER_SIZE+body.length(),crc32(frame,HEADER_SIZE+body.length()));Serial.write(frame,HEADER_SIZE+body.length()+4);}
// Configuration payload is SSID NUL password; no printable logs or credentials on wire responses.
void configure(const uint8_t* payload,size_t length){size_t split=0;while(split<length&&payload[split])split++;if(split<1||split>32||split>=length||length-split-1>63){emitStatus("invalid_config");return;}String ssid,password;for(size_t i=0;i<split;i++)ssid+=(char)payload[i];for(size_t i=split+1;i<length;i++)password+=(char)payload[i];settings.putString("ssid",ssid);settings.putString("password",password);WiFi.disconnect();WiFi.begin(ssid.c_str(),password.c_str());emitStatus("wifi_connecting");}
void setup(){Serial.setRxBufferSize(4096);Serial.begin(SERIAL_BAUD);settings.begin("bosque",false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);String ssid=settings.getString("ssid","");if(ssid.length())WiFi.begin(ssid.c_str(),settings.getString("password","").c_str());server.begin();server.setNoDelay(true);emitStatus("boot");}
void loop(){
 while(Serial.available()){if(feed(usb,Serial.read())){uint8_t* f=usb.bytes;uint32_t length=read32(f+24);if(f[5]==CONFIG)configure(f+HEADER_SIZE,length);else if(f[5]==17){f[5]=129;put32(f+HEADER_SIZE+length,crc32(f,HEADER_SIZE+length));Serial.write(f,HEADER_SIZE+length+4);}else if(f[5]==ACK&&pendingLength&&read32(f+8)==pendingSequence&&memcmp(f+12,pending+12,12)==0){if(client.connected())client.write(f,HEADER_SIZE+length+4);pendingLength=0;}}}
 if(!client.connected()){if(client)client.stop();WiFiClient incoming=server.available();if(incoming){client=incoming;client.setNoDelay(true);network.length=network.expected=0;pendingLength=0;emitStatus("node_connected");}}
 if(client.connected()&&!pendingLength){while(client.available()){if(feed(network,client.read())){uint8_t* f=network.bytes;if(f[5]!=AUDIO&&f[5]!=JPEG&&f[5]!=FRAME_STATUS)continue;pendingLength=HEADER_SIZE+read32(f+24)+4;memcpy(pending,f,pendingLength);pendingSequence=read32(f+8);Serial.write(pending,pendingLength);sentAt=millis();break;}}}
 if(pendingLength&&millis()-sentAt>2000){Serial.write(pending,pendingLength);sentAt=millis();}
 if(millis()-lastStatus>10000){emitStatus("heartbeat");lastStatus=millis();}
 delay(1);
}
