// SuperDirt 起動スクリプト（ハブ用）
// - 入力 0ch（このMacでは入力を開くとヘッドレス起動で止まるため）
// - super* シンセを sc3plugins なしで「読めるものだけ」個別ロード
// - 起動後、~listen.() で 0〜f の既定割り当てを順に試聴
(
// DIRT_QUARKS: DirtRelay アプリが HOME を差し替えて起動する場合に、本来の quarks の場所を渡す
var quarks = "DIRT_QUARKS".getenv ?? { Platform.userAppSupportDir +/+ "downloaded-quarks" };
// DIRT_EXTENSIONS: アプリ起動時（HOME 差し替え）でも、ユーザーの Extensions にある UGen（sc3plugins 等）を scsynth に読ませる
"DIRT_EXTENSIONS".getenv !? { |ext| s.options.ugenPluginsPath = [Platform.resourceDir +/+ "plugins", ext, Platform.systemExtensionDir].select { |p| File.exists(p) } };
// DIRT_OUTDEVICE: DirtRelay の Output Device メニューで選んだ出力先（未設定ならシステムの既定）
// SC 3.14 は日本語などマルチバイトのデバイス名を途中で切って扱う（例: 外部ヘッドフォン → 外部）。
// フル名のままだと scsynth が一致させられず黙って既定に戻るので、SC 側の名前のうち要求名の接頭辞になっている最長のものを使う。
"DIRT_OUTDEVICE".getenv !? { |dev|
	var scName = ServerOptions.outDevices.select { |d| d.size > 0 and: { dev.beginsWith(d) } }.maxItem { |d| d.size };
	if(scName.notNil) {
		s.options.outDevice = scName;
		"HUB: output device % (SC name: %)".format(dev, scName).postln;
	} {
		"HUB: output device % not found, using system default".format(dev).postln;
	};
};
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.numBuffers = 1024 * 256;
s.options.memSize = 8192 * 32;
s.options.maxNodes = 1024 * 32;
s.latency = 0.2;
s.waitForBoot {
	var extra = quarks +/+ "SuperDirt/library/default-synths-extra.scd";
	var txt, blocks, ok = List[], ng = List[];
	~dirt = SuperDirt(2, s);
	~dirt.loadSoundFiles(quarks +/+ "Dirt-Samples/*");
	s.sync;
	// "(\n ... \n);" 単位に分割して1つずつ評価。失敗したもの（sc3plugins 依存）は飛ばす
	txt = File.readAllString(extra);
	blocks = txt.split($\n).inject([List[]], { |acc, line|
		acc.last.add(line);
		if(line.beginsWith(");")) { acc = acc.add(List[]) };
		acc
	}).collect { |l| l.join("\n") };
	blocks.do { |b|
		var name = b.findRegexp("SynthDef\\(\\\\([a-zA-Z0-9_]+)").collect(_[1]);
		name = if(name.size > 1) { name[1] } { nil };
		if(name.notNil) {
			try { b.interpret } { };
			if(SynthDescLib.global.at(name.asSymbol).notNil) { ok.add(name) } { ng.add(name) }
		}
	};
	s.sync;
	"HUB: super* loaded % : %".format(ok.size, ok).postln;
	"HUB: super* skipped % : %".format(ng.size, ng).postln;
	~dirt.start(57120, 0 ! 4);
	~dirtReady = true;
	"HUB: SuperDirt ready".postln;
};
)
