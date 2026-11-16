/* 合成模型：通用的關係與沒有名字的使用（F-71）。 */
package G {
    private import ScalarValues::*;

    part def Base {
        attribute mass :> ISQ::mass;
        attribute count : Integer;
        part wheel : Wheel [4];
        action spin : Spin;
    }
    part def Wheel;
    action def Spin;
    part def Car :> Base {
        part :>> wheel [4] {
            attribute pressure : Real;
        }
        attribute :>> count = 4;
        perform spin;
        perform action brake : Spin;
    }
    requirement def Limit {
        attribute limit : Real;
        require constraint { limit > 0 }
    }
    part car : Car;
    part spare :> car;
}
