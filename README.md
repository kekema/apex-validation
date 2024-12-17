# Custom Client-Side Validation
Gives support to quickly write your JavaScript custom Validation.

This APEX plugin offers 'Validate Item', 'Validate Page' and 'Validate IG Row' events which can be used in DA's as to define custom validation logic in a JavaScript action. In the event handler, you can use this.data as input for your constraint logic. Set this.data.valid (boolean) as the validation outcome, and set this.data.validationMessage in case of an error. The plugin can be configured with 'Instant Validation'.

![image](https://github.com/kekema/apex-validation/blob/main/custom-client-side-validation.jpg)

Custom validation can be defined for all Item Types, and for both IG Column Items as well as regular Items. 

The 'Validate Page' and 'Validate IG Row' events do support validation logic on the page/row level.

To initialize the plugin, use a DA on 'Page Load' and select 'LIB4X - Validation'. Select if you want to use 'Instant Validation'.

See for demo and more comments: [demo page](https://apex.oracle.com/pls/apex/r/yola/demo/task-validation) 
