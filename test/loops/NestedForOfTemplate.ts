import * as Alloy from "../../src/Alloy"

@Alloy.component()
export class NestedForOfTemplate extends Alloy.Component {

    private entries:Number[][] = [];

    constructor() {
        super({
            template:"<div loop-for='let values of this.entries'><br><span loop-for='let value of values'>${value}</span></div>"
        });

        this.created.then(() => {
            let self = this;
            self.entries = [
                [1, 2, 3, 4],
                [1, 2, 3, 4],
                [1, 2, 3, 4],
                [1, 2, 3, 4]
            ];
        });
    }

}