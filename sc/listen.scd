// 0〜f の既定割り当てを順に試聴（start_dirt.scd の後に実行）
(
~slots = [\superhammond, \supervibe, \supermandolin, \supersquare, \superreese, \superhoover, \superzow, \supertron,
	\supergong, \superfork, \supersiren, \superstatic, \superkick, \super808, \supersnare, \superhat];
~listen = {
	var a = NetAddr("127.0.0.1", 57120);
	fork {
		~slots.do { |name, i|
			var drum = i >= 12;
			"LISTEN slot % : %".format(i.asHexString(1).toLower, name).postln;
			if(drum) {
				4.do { a.sendBundle(0.2, ["/dirt/play", "s", name, "orbit", 1]); 0.35.wait };
			} {
				[0, 4, 7, 12].do { |nt| a.sendBundle(0.2, ["/dirt/play", "s", name, "note", nt - 12, "legato", 0.9, "delta", 0.35, "orbit", 0]); 0.35.wait };
			};
			0.8.wait;
		};
		"LISTEN done".postln;
	}
};
)
