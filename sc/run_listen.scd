// 起動 → 試聴 → そのまま待機（SuperDirt は動かしたまま）
(
var dir = thisProcess.nowExecutingPath.dirname;
(dir +/+ "start_dirt.scd").load;
(dir +/+ "listen.scd").load;
fork { while { ~dirtReady != true } { 0.5.wait }; 1.wait; ~listen.() };
)
